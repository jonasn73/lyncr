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
  getReceptionistTalkAggregate,
  getUser,
  listCallLogsForReceptionist,
} from "@/lib/db"
import type { CallLog, ReceptionistLedgerRow, ReceptionistLiveStatus, ReceptionistPortalDashboard } from "@/lib/types"

function startOfUtcDayIso(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString()
}

function startOfNextUtcDayIso(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString()
}

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
  ctx: ReceptionistPortalContext
): Promise<ReceptionistPortalDashboard> {
  const billing_cycle = await getBillingCycleWindowForUser(ctx.owner_user_id)
  const todayStart = startOfUtcDayIso()
  const todayEnd = startOfNextUtcDayIso()

  const [today_earnings, pay_period_earnings, periodAggregate, ledgerCalls, live_status] = await Promise.all([
    earningsForRange(ctx, todayStart, todayEnd),
    earningsForRange(ctx, billing_cycle.start, billing_cycle.end),
    getReceptionistTalkAggregate(ctx.owner_user_id, ctx.receptionist.id, billing_cycle.start, billing_cycle.end),
    listCallLogsForReceptionist(ctx.owner_user_id, ctx.receptionist.id, {
      limit: 40,
      start: billing_cycle.start,
      end: billing_cycle.end,
    }),
    buildLiveStatus(ctx),
  ])

  const payConfig = receptionistPayConfig(ctx.receptionist)
  const ledger = ledgerCalls.map((call) => ledgerRowFromCall(call, ctx.business_name, payConfig))

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
    // WEB calling only carries audio once a SIP username is provisioned for this receptionist.
    web_calling_available: Boolean(ctx.receptionist.sip_username?.trim()),
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
  }
}
