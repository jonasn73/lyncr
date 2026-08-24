// Receptionist portal dashboard — metrics, live status, and earnings ledger assembly.

import {
  calculateReceptionistPay,
  calculateReceptionistPayTotal,
  isAnsweredReceptionistCall,
  receptionistPayConfig,
  resolveReceptionistLegDurationSeconds,
} from "@/lib/receptionist-pay"
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

function ledgerRowFromCall(call: CallLog, businessName: string, payConfig: ReturnType<typeof receptionistPayConfig>): ReceptionistLedgerRow {
  const duration_seconds = resolveReceptionistLegDurationSeconds(call)
  const isAnswered = isAnsweredReceptionistCall(call.status)
  const payout_usd = calculateReceptionistPay({
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

async function earningsForRange(
  ctx: ReceptionistPortalContext,
  start: string,
  end: string
): Promise<number> {
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

async function buildLiveStatus(ctx: ReceptionistPortalContext): Promise<ReceptionistLiveStatus> {
  const active = await getActiveCallLogForReceptionist(ctx.receptionist.id)
  if (active && (active.answered_at || /answered|in-progress/i.test(active.status))) {
    const callOwner = active.user_id !== ctx.owner_user_id ? await getUser(active.user_id) : null
    const business_name =
      callOwner?.business_name?.trim() || ctx.business_name
    return {
      mode: "on_call",
      business_name,
      caller_number: active.from_number,
      caller_name: active.caller_name,
      started_at: active.answered_at ?? active.created_at,
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
  const ledger = ledgerCalls.map((call) => ledgerRowFromCall(call, ctx.business_name, payConfig))
  const recent_calls = recentCalls.map((call) => ledgerRowFromCall(call, ctx.business_name, payConfig))

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
    },
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
