// ============================================
// Compensation calculation — pure functions, one payable event at a time
// ============================================
// Every component on a plan is offered the event; the ones that apply produce an
// earning line. A line becomes one earnings_ledger row (scripts/145), so the plan
// version and the exact component that produced the number travel with it.
//
// Nothing here reads the database or the clock. The caller supplies the event, and
// for commission it supplies the resolved money — see resolveJobCommissionBase in
// lib/job-payments.ts, which is the only thing allowed to decide what a job is worth.

import {
  MICROS_PER_CENT,
  applyBasisPoints,
  microsToCents,
  secondsPerTimeUnit,
  type CommissionBasis,
  type PayComponent,
  type PayComponentKind,
} from "@/lib/compensation/plan-schema"

/** A call leg that has ended. */
export interface CallPayEvent {
  kind: "CALL"
  /** call_logs.id */
  id: string
  occurred_at: string
  /** Requires a real pickup — see isAnsweredReceptionistCall. */
  answered: boolean
  /** answered_at → ended_at, in whole seconds. Never the full call duration. */
  talk_seconds: number
}

/** A job, at the moment its state changed. */
export interface JobPayEvent {
  kind: "JOB"
  /** ai_leads.id */
  id: string
  occurred_at: string
  booked: boolean
  completed: boolean
  paid: boolean
  /** What the job is worth under each basis, in cents. Resolved by the caller. */
  base_cents: Record<CommissionBasis, number>
}

/** A closed shift. */
export interface ShiftPayEvent {
  kind: "SHIFT"
  /** work_shifts.id */
  id: string
  occurred_at: string
  seconds: number
}

export type PayEvent = CallPayEvent | JobPayEvent | ShiftPayEvent

export type EarningSourceKind = "CALL" | "JOB" | "SHIFT" | "ADJUSTMENT"

/** One computed amount, ready to become an earnings_ledger row. */
export interface EarningLine {
  component_kind: PayComponentKind
  source_kind: EarningSourceKind
  source_id: string
  /** Signed USD cents. Rounded here and nowhere earlier. */
  amount_cents: number
  /** What was measured: talk seconds, shift seconds, job count, or commission base cents. */
  quantity: number
  rate_snapshot: PayComponent
  earned_at: string
}

function timeAmountCents(rateMicros: number, seconds: number, unitSeconds: number): number {
  return microsToCents((seconds / unitSeconds) * rateMicros)
}

/**
 * Earnings a single event produces under a set of components.
 *
 * Zero-amount lines are dropped: a call under the billable floor, a commission on a
 * job worth nothing, an unanswered leg. They would otherwise fill the ledger's
 * idempotency index with rows that say nothing happened.
 */
export function calculateEarnings(components: PayComponent[], event: PayEvent): EarningLine[] {
  const lines: EarningLine[] = []

  for (const component of components) {
    const line = calculateComponent(component, event)
    if (line && line.amount_cents !== 0) lines.push(line)
  }

  return lines
}

function calculateComponent(component: PayComponent, event: PayEvent): EarningLine | null {
  switch (event.kind) {
    case "CALL":
      return calculateForCall(component, event)
    case "JOB":
      return calculateForJob(component, event)
    case "SHIFT":
      return calculateForShift(component, event)
  }
}

function calculateForCall(component: PayComponent, event: CallPayEvent): EarningLine | null {
  // An unanswered leg earns nothing under any component. The carrier marks a call
  // "completed" when it ends, which is true of every call that rings out or lands in
  // the hold menu, so the answered flag — not the status — is what gates pay.
  if (!event.answered) return null

  const talkSeconds = Math.max(0, event.talk_seconds)

  if (component.kind === "TIME" && component.basis === "TALK") {
    if (talkSeconds < (component.min_billable_seconds ?? 0)) return null
    return {
      component_kind: "TIME",
      source_kind: "CALL",
      source_id: event.id,
      amount_cents: timeAmountCents(
        component.rate_micros,
        talkSeconds,
        secondsPerTimeUnit(component.unit)
      ),
      quantity: talkSeconds,
      rate_snapshot: component,
      earned_at: event.occurred_at,
    }
  }

  if (component.kind === "PER_EVENT" && component.event === "ANSWERED_CALL") {
    if (talkSeconds < (component.min_billable_seconds ?? 0)) return null
    return {
      component_kind: "PER_EVENT",
      source_kind: "CALL",
      source_id: event.id,
      amount_cents: microsToCents(component.amount_micros),
      quantity: 1,
      rate_snapshot: component,
      earned_at: event.occurred_at,
    }
  }

  return null
}

function calculateForJob(component: PayComponent, event: JobPayEvent): EarningLine | null {
  if (component.kind === "PER_EVENT") {
    if (component.event === "BOOKED_JOB" && !event.booked) return null
    if (component.event === "COMPLETED_JOB" && !event.completed) return null
    if (component.event === "ANSWERED_CALL") return null
    return {
      component_kind: "PER_EVENT",
      source_kind: "JOB",
      source_id: event.id,
      amount_cents: microsToCents(component.amount_micros),
      quantity: 1,
      rate_snapshot: component,
      earned_at: event.occurred_at,
    }
  }

  if (component.kind === "COMMISSION") {
    if (!jobMeetsConditions(component.require, event)) return null
    const baseCents = Math.max(0, Math.round(event.base_cents[component.basis] ?? 0))
    return {
      component_kind: "COMMISSION",
      source_kind: "JOB",
      source_id: event.id,
      amount_cents: applyBasisPoints(baseCents, component.rate_bps),
      quantity: baseCents,
      rate_snapshot: component,
      earned_at: event.occurred_at,
    }
  }

  return null
}

function jobMeetsConditions(
  require: readonly string[],
  event: JobPayEvent
): boolean {
  // Empty conditions would pay on any lead at all. validatePayComponents rejects
  // that when a plan is saved; this is the second gate for rows already stored.
  if (require.length === 0) return false
  for (const condition of require) {
    if (condition === "BOOKED" && !event.booked) return false
    if (condition === "COMPLETED" && !event.completed) return false
    if (condition === "PAID" && !event.paid) return false
  }
  return true
}

function calculateForShift(component: PayComponent, event: ShiftPayEvent): EarningLine | null {
  if (component.kind !== "TIME" || component.basis !== "ON_SHIFT") return null
  const seconds = Math.max(0, event.seconds)
  return {
    component_kind: "TIME",
    source_kind: "SHIFT",
    source_id: event.id,
    amount_cents: timeAmountCents(component.rate_micros, seconds, secondsPerTimeUnit(component.unit)),
    quantity: seconds,
    rate_snapshot: component,
    earned_at: event.occurred_at,
  }
}

/**
 * The top-up owed at the end of a pay period, if any.
 *
 * A W-2 receptionist waiting for the phone to ring is "engaged to wait" — that time
 * is hours worked. Talk-time or per-call pay alone does not clear minimum wage on a
 * quiet shift, so the period is compared against hours × the applicable floor and
 * the difference is paid as its own ledger row.
 *
 * This is a FLOOR, not payroll. It does not compute overtime: the FLSA regular rate
 * for a worker earning commission requires allocating that commission back across
 * the workweeks it was earned in, and premium pay is a payroll provider's job.
 */
export function calculateMinimumWageTopUp(params: {
  components: PayComponent[]
  /** Everything else the worker earned in the period, in cents. */
  periodEarnedCents: number
  /** Clocked seconds in the period (work_shifts). No shifts means no floor to apply. */
  onShiftSeconds: number
  /** pay_periods.id — the ledger's idempotency key for this row. */
  payPeriodId: string
  earnedAt: string
}): EarningLine | null {
  const component = params.components.find((c) => c.kind === "MINIMUM_WAGE_TOPUP")
  if (!component || component.kind !== "MINIMUM_WAGE_TOPUP") return null

  const seconds = Math.max(0, params.onShiftSeconds)
  if (seconds <= 0) return null

  const floorCents = Math.round((seconds / 3600) * (component.hourly_floor_micros / MICROS_PER_CENT))
  const shortfall = floorCents - Math.round(params.periodEarnedCents)
  if (shortfall <= 0) return null

  return {
    component_kind: "MINIMUM_WAGE_TOPUP",
    source_kind: "ADJUSTMENT",
    source_id: params.payPeriodId,
    amount_cents: shortfall,
    quantity: seconds,
    rate_snapshot: component,
    earned_at: params.earnedAt,
  }
}

/** Reverse a line — a refunded job, a corrected timesheet. Same shape, negated. */
export function reverseEarningLine(line: EarningLine, reversedAt: string): EarningLine {
  return { ...line, amount_cents: -line.amount_cents, earned_at: reversedAt }
}

/** Total of a set of lines, in cents. */
export function sumEarningCents(lines: readonly EarningLine[]): number {
  return lines.reduce((total, line) => total + line.amount_cents, 0)
}
