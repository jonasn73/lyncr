// Receptionist payout helpers — duration resolution + FLAT_RATE / PER_MINUTE earnings.
//
// The two pay modes here are the legacy shape (receptionists.pay_mode, scripts/039).
// Compensation now lives in compensation_plans as a set of components (scripts/144),
// and the calculations below delegate to that engine so there is one place where
// money is computed. The exported signatures are unchanged — callers still work in
// dollars — and the behavior is identical, including the 20-second floor.

import {
  calculateEarnings,
  sumEarningCents,
  type CallPayEvent,
} from "@/lib/compensation/calculate"
import {
  DEFAULT_ANSWERED_CALL_MIN_SECONDS,
  dollarsToMicros,
  microsToCents,
  type PayComponent,
} from "@/lib/compensation/plan-schema"
import type { CallLog, Receptionist } from "@/lib/types"

/** How a receptionist is paid for answered inbound legs. */
export type ReceptionistPayMode = "FLAT_RATE" | "PER_MINUTE"

/** Default payout settings when a receptionist row has no overrides. */
const RECEPTIONIST_PAY_DEFAULTS = {
  pay_mode: "PER_MINUTE" as ReceptionistPayMode,
  rate_per_minute: 0.25,
  flat_rate_usd: 2.5,
}

/** Input for a single payout calculation. */
export type ReceptionistPayInput = {
  /** Talk duration in whole seconds (from answered_at → ended_at when available). */
  durationInSeconds: number
  /** FLAT_RATE pays once per answered call; PER_MINUTE uses duration + rate. */
  payMode: ReceptionistPayMode
  /** Used when payMode is PER_MINUTE (defaults to 0.25). */
  ratePerMinute?: number
  /** Used when payMode is FLAT_RATE (defaults to 2.50). */
  flatRateUsd?: number
  /** When false, payout is zero (missed / unanswered legs). */
  isAnswered: boolean
}

/**
 * Statuses a picked-up leg can carry.
 *
 * Never sufficient on their own. "completed" is the carrier's word for *the call ended*,
 * which is true of every call that rings out, hits the hold menu, or goes to voicemail.
 * Pay requires answered_at as well — see isAnsweredReceptionistCall.
 */
const ANSWERED_RECEPTIONIST_STATUSES = new Set([
  "answered",
  "completed",
  "in-progress",
])

/**
 * Shortest pickup that earns anything.
 *
 * An answer-and-immediately-hang-up is a dropped call, not a conversation, and under
 * FLAT_RATE it would otherwise pay the same as a real one.
 */
export const MIN_BILLABLE_TALK_SECONDS = DEFAULT_ANSWERED_CALL_MIN_SECONDS

/**
 * True when a leg should earn receptionist pay.
 *
 * Requires an actual pickup. The old version took only the status, so any call reaching
 * the carrier's terminal state paid out: at Key Squad 502's volume that counted 401 of
 * 403 calls as payable when 208 had been answered.
 */
export function isAnsweredReceptionistCall(
  call: Pick<CallLog, "status" | "answered_at">
): boolean {
  if (!call?.answered_at) return false
  return ANSWERED_RECEPTIONIST_STATUSES.has(String(call.status ?? "").trim().toLowerCase())
}

/**
 * Talk seconds for a receptionist leg — answered_at → ended_at, and nothing else.
 *
 * There is deliberately no duration_seconds fallback. That column is the whole call
 * including ring and hold time, so falling back to it billed a caller's wait as though
 * someone had been talking to them.
 */
export function resolveReceptionistLegDurationSeconds(
  call: Pick<CallLog, "answered_at" | "ended_at" | "duration_seconds">
): number {
  const answeredAt = call.answered_at ? Date.parse(call.answered_at) : NaN
  const endedAt = call.ended_at ? Date.parse(call.ended_at) : NaN
  if (!Number.isFinite(answeredAt) || !Number.isFinite(endedAt) || endedAt < answeredAt) {
    return 0
  }
  return Math.max(0, Math.round((endedAt - answeredAt) / 1000))
}

/** SQL expression (alias `cl`) matching resolveReceptionistLegDurationSeconds in Postgres. */
export const RECEPTIONIST_LEG_DURATION_SQL = `
  GREATEST(0, COALESCE(
    CASE
      WHEN cl.answered_at IS NOT NULL AND cl.ended_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (cl.ended_at - cl.answered_at))::int
    END,
    0
  ))
`

/**
 * SQL filter (alias `cl`) for legs eligible for pay.
 * Mirrors isAnsweredReceptionistCall — keep the two in step.
 */
export const ANSWERED_RECEPTIONIST_STATUS_SQL = `
  cl.answered_at IS NOT NULL
  AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
`

/**
 * The legacy pay mode expressed as compensation plan components.
 *
 * FLAT_RATE  → PER_EVENT on ANSWERED_CALL
 * PER_MINUTE → TIME / MINUTE on TALK
 *
 * Both carry the 20-second floor explicitly, because it currently applies to either
 * mode as a hard-coded constant. New plans built in the editor choose their own.
 */
function legacyPayModeComponents(params: {
  payMode: ReceptionistPayMode
  ratePerMinute?: number
  flatRateUsd?: number
}): PayComponent[] {
  if (params.payMode === "FLAT_RATE") {
    return [
      {
        kind: "PER_EVENT",
        event: "ANSWERED_CALL",
        amount_micros: dollarsToMicros(params.flatRateUsd ?? RECEPTIONIST_PAY_DEFAULTS.flat_rate_usd),
        min_billable_seconds: MIN_BILLABLE_TALK_SECONDS,
      },
    ]
  }
  return [
    {
      kind: "TIME",
      unit: "MINUTE",
      basis: "TALK",
      rate_micros: dollarsToMicros(params.ratePerMinute ?? RECEPTIONIST_PAY_DEFAULTS.rate_per_minute),
      min_billable_seconds: MIN_BILLABLE_TALK_SECONDS,
    },
  ]
}

/**
 * Calculate payout for one answered receptionist leg.
 * FLAT_RATE → flat amount per answered call.
 * PER_MINUTE → (durationInSeconds / 60) * ratePerMinute.
 */
export function calculateReceptionistPay(input: ReceptionistPayInput): number {
  const components = legacyPayModeComponents(input)
  const event: CallPayEvent = {
    kind: "CALL",
    id: "",
    occurred_at: "",
    answered: input.isAnswered,
    talk_seconds: Math.max(0, input.durationInSeconds),
  }
  return centsToUsd(sumEarningCents(calculateEarnings(components, event)))
}

/** Aggregate payout across many answered legs for one receptionist. */
export function calculateReceptionistPayTotal(params: {
  payMode: ReceptionistPayMode
  ratePerMinute?: number
  flatRateUsd?: number
  answeredCalls: number
  totalTalkSeconds: number
}): number {
  // An aggregate, not a sum of per-call results: the caller has only the totals, so
  // the per-call floor cannot be applied here. Once earnings come from the ledger
  // (scripts/145) this rollup is replaced by summing rows that each honored it.
  const [component] = legacyPayModeComponents(params)

  if (component.kind === "PER_EVENT") {
    return centsToUsd(microsToCents(Math.max(0, params.answeredCalls) * component.amount_micros))
  }
  if (component.kind === "TIME") {
    const units = Math.max(0, params.totalTalkSeconds) / 60
    return centsToUsd(microsToCents(units * component.rate_micros))
  }
  return 0
}

/** Pay settings from a receptionist row (with safe defaults). */
export function receptionistPayConfig(receptionist: Pick<
  Receptionist,
  "pay_mode" | "rate_per_minute" | "flat_rate_usd"
>): {
  payMode: ReceptionistPayMode
  ratePerMinute: number
  flatRateUsd: number
} {
  return {
    payMode: receptionist.pay_mode ?? RECEPTIONIST_PAY_DEFAULTS.pay_mode,
    ratePerMinute: receptionist.rate_per_minute ?? RECEPTIONIST_PAY_DEFAULTS.rate_per_minute,
    flatRateUsd: receptionist.flat_rate_usd ?? RECEPTIONIST_PAY_DEFAULTS.flat_rate_usd,
  }
}

/**
 * Integer cents back to the dollars these helpers have always returned.
 *
 * The rounding already happened in micros→cents, so this is a plain divide — doing
 * it again on the dollar value is where the old float drift came from.
 */
function centsToUsd(cents: number): number {
  return cents / 100
}
