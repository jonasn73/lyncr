// Receptionist portal dashboard — metrics, live status, and earnings ledger assembly.

import {
  calculateReceptionistPay,
  calculateReceptionistPayTotal,
  isAnsweredReceptionistCall,
  receptionistPayConfig,
  resolveReceptionistLegDurationSeconds,
} from "@/lib/receptionist-pay"
import { getEarningsTotal, sumEarningsBySource } from "@/lib/compensation/ledger"
import { resolveReceptionistComponents } from "@/lib/compensation/plans"
import { describePayPlan } from "@/lib/compensation/plan-schema"
import { resolveBusinessType } from "@/lib/business-type"
import type { ReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import {
  getActiveCallLogForReceptionist,
  getBillingCycleWindowForUser,
  getCustomerNamesByPhonesForUser,
  getReceptionistTalkAggregate,
  getUser,
  listCallLogsForReceptionist,
} from "@/lib/db"
import type { CallLog, ReceptionistLedgerRow, ReceptionistLiveStatus, ReceptionistPortalDashboard } from "@/lib/types"

import { envFlagOn } from "@/lib/lyncr-env"
import { zonedDayRangeIso } from "@/lib/zoned-day"

/** Mirror of readInboundCallControlEnabled — kept local to avoid pulling the voice webhook module into portal. */
function isCallControlInboundEnabled(): boolean {
  return envFlagOn("INBOUND_CALL_CONTROL")
}

// "Today" used to start at UTC midnight, which is 8pm Eastern — an evening shift watched
// its own earnings reset before the shift ended. Day bounds now come from the operator's
// timezone via zonedDayRangeIso.

function ledgerRowFromCall(
  call: CallLog,
  businessName: string,
  payConfig: ReturnType<typeof receptionistPayConfig>,
  /** call_logs.id → cents already on the earnings ledger for this call. */
  settledCents?: Map<string, number>
): ReceptionistLedgerRow {
  const duration_seconds = resolveReceptionistLegDurationSeconds(call)
  const isAnswered = isAnsweredReceptionistCall(call)
  // What the worker was actually paid beats what the current rate would pay now —
  // that is the whole point of settling at the time of the call.
  const settled = settledCents?.get(call.id)
  const payout_usd =
    settled !== undefined
      ? settled / 100
      : calculateReceptionistPay({
          durationInSeconds: duration_seconds,
          payMode: payConfig.payMode,
          ratePerMinute: payConfig.ratePerMinute,
          flatRateUsd: payConfig.flatRateUsd,
          isAnswered,
        })
  return {
    id: call.id,
    created_at: call.created_at,
    from_number: call.from_number,
    caller_name: call.caller_name,
    status: call.status,
    duration_seconds,
    payout_usd,
    business_name: businessName,
  }
}

/**
 * Earnings for a window — from the ledger when it has rows, otherwise recomputed.
 *
 * The fallback covers the gap between scripts/145 running and
 * scripts/backfill-earnings-ledger.ts finishing, when a settled window and an
 * un-backfilled one both look like zero rows from here. Once a window is settled the
 * ledger wins, and a rate change stops rewriting what the worker already earned.
 */
async function earningsForRange(
  ctx: ReceptionistPortalContext,
  start: string,
  end: string
): Promise<number> {
  const settled = await getEarningsTotal(
    { role: "receptionist", receptionist_id: ctx.receptionist.id },
    start,
    end
  )
  if (settled.rows > 0) return settled.cents / 100

  const payConfig = receptionistPayConfig(ctx.receptionist)
  const aggregate = await getReceptionistTalkAggregate(
    ctx.owner_user_id,
    ctx.receptionist.id,
    start,
    end
  )
  return calculateReceptionistPayTotal({
    payMode: payConfig.payMode,
    ratePerMinute: payConfig.ratePerMinute,
    flatRateUsd: payConfig.flatRateUsd,
    answeredCalls: aggregate.answered_calls,
    totalTalkSeconds: aggregate.total_seconds,
  })
}

/** Last 10 digits — call logs and CRM disagree on +1 and formatting. */
function phoneMatchKey(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "")
  return digits.length > 10 ? digits.slice(-10) : digits
}

/** Fill `caller_name` from CRM on rows the carrier left anonymous. Mutates in place. */
async function attachCustomerNames(
  ownerUserId: string,
  rows: ReceptionistLedgerRow[]
): Promise<void> {
  const unnamed = rows.filter((row) => !row.caller_name?.trim())
  if (unnamed.length === 0) return
  try {
    const names = await getCustomerNamesByPhonesForUser(
      ownerUserId,
      unnamed.map((row) => row.from_number ?? "")
    )
    if (names.size === 0) return
    for (const row of unnamed) {
      const name = names.get(phoneMatchKey(row.from_number))
      if (name) row.caller_name = name
    }
  } catch {
    // A name is a nicety — never fail the whole dashboard over it.
  }
}

/**
 * Settled amounts for the calls about to be shown, keyed by call id.
 *
 * Queried over one window wide enough to cover every row on screen rather than per
 * call. Ledger rows are stamped with the call's end time, so the window opens at the
 * oldest call shown and closes a day out to tolerate clock skew on late webhooks.
 */
async function settledCentsForCalls(
  ctx: ReceptionistPortalContext,
  calls: CallLog[],
  fallbackStart: string
): Promise<Map<string, number>> {
  if (calls.length === 0) return new Map()

  const timestamps = calls
    .map((call) => Date.parse(call.created_at))
    .filter((ms) => Number.isFinite(ms))
  const start = timestamps.length
    ? new Date(Math.min(...timestamps)).toISOString()
    : fallbackStart
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  try {
    return await sumEarningsBySource(
      { role: "receptionist", receptionist_id: ctx.receptionist.id },
      "CALL",
      start,
      end
    )
  } catch {
    // Per-call amounts are a refinement — the row still renders a computed payout.
    return new Map()
  }
}

async function buildLiveStatus(ctx: ReceptionistPortalContext): Promise<ReceptionistLiveStatus> {
  const active = await getActiveCallLogForReceptionist(ctx.receptionist.id)
  const answered = Boolean(active?.answered_at) || /answered|in-progress/i.test(active?.status ?? "")
  const ringing = !answered && /ringing/i.test(active?.status ?? "")

  if (active && (answered || ringing)) {
    const callOwner = active.user_id !== ctx.owner_user_id ? await getUser(active.user_id) : null
    const business_name =
      callOwner?.business_name?.trim() || ctx.business_name
    return {
      // Ringing and answered carry the same fields; only what the header says differs.
      mode: ringing ? "ringing" : "on_call",
      business_name,
      caller_number: active.from_number,
      caller_name: active.caller_name,
      started_at: active.answered_at ?? active.created_at,
      // Carried so the portal can open intake from a poll, not only from a realtime
      // event — the owner console has always worked this way and the portal did not.
      provider_call_sid: active.provider_call_sid?.trim() || null,
      business_type: resolveBusinessType(
        (callOwner ?? (await getUser(ctx.owner_user_id).catch(() => null)))?.industry ?? null
      ),
    }
  }
  return {
    mode: "ready",
    business_name: ctx.business_name,
  }
}

/** Full receptionist portal payload for the dashboard page. */
export async function buildReceptionistPortalDashboard(
  ctx: ReceptionistPortalContext,
  options?: { timezone?: string | null }
): Promise<ReceptionistPortalDashboard> {
  const billing_cycle = await getBillingCycleWindowForUser(ctx.owner_user_id)
  const { start: todayStart, end: todayEnd } = zonedDayRangeIso(options?.timezone)

  const [today_earnings, pay_period_earnings, periodAggregate, ledgerCalls, recentCalls, live_status] =
    await Promise.all([
      earningsForRange(ctx, todayStart, todayEnd),
      earningsForRange(ctx, billing_cycle.start, billing_cycle.end),
      getReceptionistTalkAggregate(ctx.owner_user_id, ctx.receptionist.id, billing_cycle.start, billing_cycle.end),
      listCallLogsForReceptionist(ctx.owner_user_id, ctx.receptionist.id, {
        limit: 40,
        start: billing_cycle.start,
        end: billing_cycle.end,
      }),
      // Calls tab: all calls that actually routed to this receptionist (not company-wide).
      listCallLogsForReceptionist(ctx.owner_user_id, ctx.receptionist.id, { limit: 50 }),
      buildLiveStatus(ctx),
    ])

  const payConfig = receptionistPayConfig(ctx.receptionist)

  // Straight from the plan, so the rate a receptionist reads is the one that is
  // actually paying them. resolveReceptionistComponents falls back to the legacy
  // columns only for a roster row that has no plan yet.
  const { components } = await resolveReceptionistComponents(ctx.receptionist).catch(() => ({
    components: [],
  }))
  const pay_summary = components.length > 0 ? describePayPlan(components) : ""

  // Per-call amounts as settled, so a row in the ledger shows what was paid for that
  // call rather than what the worker's current rate would pay for it today. The
  // window spans both lists — Recent calls reaches further back than the pay period.
  const shownCalls = [...ledgerCalls, ...recentCalls]
  const settledCents = await settledCentsForCalls(ctx, shownCalls, billing_cycle.start)

  const ledger = ledgerCalls.map((call) =>
    ledgerRowFromCall(call, ctx.business_name, payConfig, settledCents)
  )
  const recent_calls = recentCalls.map((call) =>
    ledgerRowFromCall(call, ctx.business_name, payConfig, settledCents)
  )

  // The Calls tab showed bare phone numbers even for customers already on file. Fill in the
  // names CRM knows, without overwriting a name the carrier actually supplied.
  await attachCustomerNames(ctx.owner_user_id, [...ledger, ...recent_calls])

  return {
    receptionist: {
      id: ctx.receptionist.id,
      name: ctx.receptionist.name,
      is_active: ctx.receptionist.is_active,
      pay_mode: ctx.receptionist.pay_mode,
      rate_per_minute: ctx.receptionist.rate_per_minute,
      flat_rate_usd: ctx.receptionist.flat_rate_usd,
      routing_endpoint: ctx.receptionist.routing_endpoint ?? "CELL",
      capabilities: ctx.receptionist.capabilities,
    },
    pay_summary,
    // WEB media can register once a SIP username is provisioned.
    web_calling_available: Boolean(ctx.receptionist.sip_username?.trim()),
    // Call Control inbound still dials PSTN only — browser ring is not live there yet.
    // TeXML can dial sip: when endpoint=WEB + sip_username. Flip when CC SIP dial ships.
    browser_inbound_live:
      Boolean(ctx.receptionist.sip_username?.trim()) && !isCallControlInboundEnabled(),
    business_name: ctx.business_name,
    live_status,
    metrics: {
      today_earnings,
      pay_period_earnings,
      total_active_talk_seconds: periodAggregate.total_seconds,
      total_active_talk_minutes: Math.round((periodAggregate.total_seconds / 60) * 10) / 10,
    },
    billing_cycle,
    ledger,
    recent_calls,
  }
}
