// ============================================
// Compensation plan schema — components, money units, parsing, validation
// ============================================
// A pay plan is a SET of components, not a mode. "Per second plus commission on
// completed jobs" is two components on one plan; the alternative is an enum that
// grows PER_SECOND_PLUS_COMMISSION, then HOURLY_PLUS_COMMISSION, then
// HOURLY_PLUS_PER_JOB, forever.
//
// Money lives in two integer units and never in a float:
//
//   micros — millionths of a dollar, for RATES. $0.25/min is $0.004166.../sec, and
//            the old receptionists.rate_per_minute NUMERIC(6,4) truncated that to
//            0.0042, overpaying 0.8% on every billed second. Rates are stored at
//            their own unit ($0.25 per MINUTE = 250_000 micros) so nothing is lost.
//   cents  — integer USD, for computed AMOUNTS. Rounding happens once, at the
//            earnings_ledger row, never mid-calculation.
//
// Persisted as JSONB in compensation_plans.components (scripts/144).

/** Millionths of a dollar in one dollar. */
export const MICROS_PER_DOLLAR = 1_000_000

/** Micros in one cent. */
export const MICROS_PER_CENT = 10_000

export type EmploymentType = "W2_EMPLOYEE" | "CONTRACTOR_1099" | "UNSPECIFIED"

export type WorkerRole = "receptionist" | "field_tech"

export type PayComponentKind = "TIME" | "PER_EVENT" | "COMMISSION" | "MINIMUM_WAGE_TOPUP"

/** The unit a TIME rate is quoted in. Storing the unit avoids pre-dividing a rate. */
export type TimeUnit = "SECOND" | "MINUTE" | "HOUR"

/** TALK = answered_at → ended_at on a call. ON_SHIFT = clocked time (work_shifts, 146). */
export type TimeBasis = "TALK" | "ON_SHIFT"

export type PayEventName = "ANSWERED_CALL" | "BOOKED_JOB" | "COMPLETED_JOB"

/**
 * Which money on a job the commission percentage applies to.
 *
 * SUBTOTAL_EXCL_TAX is the default in the editor: commissioning the gross means
 * paying a percentage of sales tax the business is about to remit, and of parts
 * cost it already paid out.
 */
export type CommissionBasis = "COLLECTED_TOTAL" | "SUBTOTAL_EXCL_TAX" | "LABOR_ONLY"

/** Job states a commission can be gated on. All listed conditions must hold. */
export type CommissionCondition = "BOOKED" | "COMPLETED" | "PAID"

/** Pay for time — per second, per minute, or per hour. */
export interface TimePayComponent {
  kind: "TIME"
  unit: TimeUnit
  basis: TimeBasis
  /** Micros per `unit`. $0.25/min = 250_000 with unit MINUTE. */
  rate_micros: number
  /** Talk-time floor; a leg shorter than this earns nothing. Ignored for ON_SHIFT. */
  min_billable_seconds?: number
}

/** A flat amount each time something happens. */
export interface PerEventPayComponent {
  kind: "PER_EVENT"
  event: PayEventName
  amount_micros: number
  /** ANSWERED_CALL only — a two-second pickup should not earn a full flat fee. */
  min_billable_seconds?: number
}

/** A percentage of a job's money, gated on the job reaching certain states. */
export interface CommissionPayComponent {
  kind: "COMMISSION"
  /** Basis points. 500 = 5.00%. */
  rate_bps: number
  basis: CommissionBasis
  require: CommissionCondition[]
}

/**
 * W-2 only. After a period's other components are summed, top the worker up to
 * hours × floor if they came in under it.
 *
 * A receptionist waiting for the phone to ring is "engaged to wait" — that time is
 * hours worked, and talk-time-only pay does not clear minimum wage on a slow shift.
 * Requires shift data (work_shifts, 146) to mean anything.
 */
export interface MinimumWageTopUpComponent {
  kind: "MINIMUM_WAGE_TOPUP"
  /** The applicable floor — federal, state, or local, whichever is highest. */
  hourly_floor_micros: number
}

export type PayComponent =
  | TimePayComponent
  | PerEventPayComponent
  | CommissionPayComponent
  | MinimumWageTopUpComponent

/**
 * Default talk floor for a flat per-answered-call fee.
 *
 * Matches MIN_BILLABLE_TALK_SECONDS in lib/receptionist-pay.ts, which this replaces.
 * An answer-and-hang-up is a dropped call, not a conversation, and under a flat fee
 * it would otherwise pay the same as a real one.
 */
export const DEFAULT_ANSWERED_CALL_MIN_SECONDS = 20

/**
 * Default talk floor for TIME pay: none.
 *
 * Per-second and per-minute pay is already proportional, so a floor only creates a
 * cliff — 19 seconds earns nothing, 20 seconds earns 20 seconds' worth. The legacy
 * backfill in scripts/144 sets 20 explicitly on migrated plans so existing
 * receptionists keep being paid exactly as they were; only new plans get this.
 */
export const DEFAULT_TALK_TIME_MIN_SECONDS = 0

/** Longest floor the editor will accept — a full hour is already absurd. */
const MAX_MIN_BILLABLE_SECONDS = 3600

const SECONDS_PER_UNIT: Record<TimeUnit, number> = {
  SECOND: 1,
  MINUTE: 60,
  HOUR: 3600,
}

const TIME_UNITS = new Set<string>(["SECOND", "MINUTE", "HOUR"])
const TIME_BASES = new Set<string>(["TALK", "ON_SHIFT"])
const PAY_EVENTS = new Set<string>(["ANSWERED_CALL", "BOOKED_JOB", "COMPLETED_JOB"])
const COMMISSION_BASES = new Set<string>(["COLLECTED_TOTAL", "SUBTOTAL_EXCL_TAX", "LABOR_ONLY"])
const COMMISSION_CONDITIONS = new Set<string>(["BOOKED", "COMPLETED", "PAID"])

/** Fixed display order so two equivalent plans read the same way. */
const CONDITION_ORDER: CommissionCondition[] = ["BOOKED", "COMPLETED", "PAID"]

// --- money helpers ---

/** Seconds covered by one unit of a TIME component. */
export function secondsPerTimeUnit(unit: TimeUnit): number {
  return SECONDS_PER_UNIT[unit]
}

/** Micros → cents, rounded half-up. Call this once, at the end of a calculation. */
export function microsToCents(micros: number): number {
  if (!Number.isFinite(micros)) return 0
  return Math.round(micros / MICROS_PER_CENT)
}

/** Dollars → micros, for reading legacy NUMERIC columns and editor input. */
export function dollarsToMicros(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0
  return Math.round(dollars * MICROS_PER_DOLLAR)
}

/** Micros → dollars, for display only. */
export function microsToDollars(micros: number): number {
  if (!Number.isFinite(micros)) return 0
  return micros / MICROS_PER_DOLLAR
}

/** Basis points applied to an integer cent amount, rounded half-up. */
export function applyBasisPoints(baseCents: number, rateBps: number): number {
  if (!Number.isFinite(baseCents) || !Number.isFinite(rateBps)) return 0
  return Math.round((baseCents * rateBps) / 10_000)
}

// --- parsing ---

function finitePositive(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function finiteNonNegative(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/**
 * Parse one component from JSONB. Returns null for anything unrecognized rather
 * than throwing — a plan row with one corrupt component still pays out the rest,
 * and validatePayComponents is where an owner is told something is wrong.
 */
export function parsePayComponent(raw: unknown): PayComponent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const kind = String(row.kind ?? "").trim().toUpperCase()

  if (kind === "TIME") {
    const unit = String(row.unit ?? "").trim().toUpperCase()
    const basis = String(row.basis ?? "").trim().toUpperCase()
    const rate = finitePositive(row.rate_micros)
    if (!TIME_UNITS.has(unit) || !TIME_BASES.has(basis) || rate === null) return null
    const floor = finiteNonNegative(row.min_billable_seconds)
    return {
      kind: "TIME",
      unit: unit as TimeUnit,
      basis: basis as TimeBasis,
      rate_micros: rate,
      min_billable_seconds: floor ?? DEFAULT_TALK_TIME_MIN_SECONDS,
    }
  }

  if (kind === "PER_EVENT") {
    const event = String(row.event ?? "").trim().toUpperCase()
    const amount = finitePositive(row.amount_micros)
    if (!PAY_EVENTS.has(event) || amount === null) return null
    const floor = finiteNonNegative(row.min_billable_seconds)
    return {
      kind: "PER_EVENT",
      event: event as PayEventName,
      amount_micros: amount,
      min_billable_seconds:
        floor ?? (event === "ANSWERED_CALL" ? DEFAULT_ANSWERED_CALL_MIN_SECONDS : 0),
    }
  }

  if (kind === "COMMISSION") {
    const basis = String(row.basis ?? "").trim().toUpperCase()
    const bps = finitePositive(row.rate_bps)
    if (!COMMISSION_BASES.has(basis) || bps === null) return null
    const require = Array.isArray(row.require)
      ? row.require
          .map((c) => String(c).trim().toUpperCase())
          .filter((c): c is CommissionCondition => COMMISSION_CONDITIONS.has(c))
      : []
    return {
      kind: "COMMISSION",
      rate_bps: bps,
      basis: basis as CommissionBasis,
      require: CONDITION_ORDER.filter((c) => require.includes(c)),
    }
  }

  if (kind === "MINIMUM_WAGE_TOPUP") {
    const floor = finitePositive(row.hourly_floor_micros)
    if (floor === null) return null
    return { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: floor }
  }

  return null
}

/** Parse the whole components array, dropping anything unrecognized. */
export function parsePayComponents(raw: unknown): PayComponent[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parsePayComponent).filter((c): c is PayComponent => c !== null)
}

// --- validation ---

export interface PlanValidation {
  /** Blocking. The plan must not be saved. */
  errors: string[]
  /** Non-blocking, but the owner should see them before signing. */
  warnings: string[]
}

/**
 * Check a set of components before saving.
 *
 * Errors catch plans that would pay twice or pay nothing. Warnings carry the
 * compliance risks that are the owner's call to accept — chiefly a W-2 worker on
 * piece-rate pay with no minimum-wage floor.
 */
export function validatePayComponents(
  components: PayComponent[],
  options: { employmentType: EmploymentType }
): PlanValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (components.length === 0) {
    errors.push("A pay plan needs at least one component.")
    return { errors, warnings }
  }

  const timeByBasis = new Map<TimeBasis, number>()
  const perEventByName = new Map<PayEventName, number>()
  let commissionCount = 0
  let topUpCount = 0

  for (const component of components) {
    switch (component.kind) {
      case "TIME": {
        timeByBasis.set(component.basis, (timeByBasis.get(component.basis) ?? 0) + 1)
        const floor = component.min_billable_seconds ?? 0
        if (floor > MAX_MIN_BILLABLE_SECONDS) {
          errors.push("A minimum billable time of over an hour is not a floor, it is a cap.")
        }
        if (component.basis === "ON_SHIFT" && floor > 0) {
          warnings.push("A minimum billable time has no effect on shift-based pay and will be ignored.")
        }
        break
      }
      case "PER_EVENT": {
        perEventByName.set(component.event, (perEventByName.get(component.event) ?? 0) + 1)
        if (component.event !== "ANSWERED_CALL" && (component.min_billable_seconds ?? 0) > 0) {
          warnings.push("A minimum billable time only applies to answered calls and will be ignored.")
        }
        break
      }
      case "COMMISSION": {
        commissionCount += 1
        if (component.rate_bps > 10_000) {
          errors.push("Commission cannot exceed 100% of the job.")
        }
        if (component.require.length === 0) {
          errors.push(
            "Commission needs at least one condition — otherwise it pays on every lead, booked or not."
          )
        }
        if (component.basis === "COLLECTED_TOTAL") {
          warnings.push(
            "Commission on the collected total includes sales tax and parts cost. Most plans use the subtotal excluding tax."
          )
        }
        if (!component.require.includes("PAID")) {
          warnings.push(
            "Commission is not gated on payment, so it will be owed even if the customer never pays."
          )
        }
        break
      }
      case "MINIMUM_WAGE_TOPUP": {
        topUpCount += 1
        if (options.employmentType !== "W2_EMPLOYEE") {
          errors.push("A minimum-wage top-up applies to W-2 employees, not contractors.")
        }
        break
      }
    }
  }

  for (const [basis, count] of timeByBasis) {
    if (count > 1) {
      errors.push(
        basis === "TALK"
          ? "Two rates for talk time would pay the same seconds twice."
          : "Two rates for shift time would pay the same hours twice."
      )
    }
  }
  for (const [event, count] of perEventByName) {
    if (count > 1) {
      errors.push(`Two flat amounts for ${describeEventWithArticle(event)} would pay it twice.`)
    }
  }
  if (commissionCount > 1) {
    errors.push("Only one commission component is supported. Tiered commission is not available yet.")
  }
  if (topUpCount > 1) {
    errors.push("A plan can only have one minimum-wage floor.")
  }

  if (options.employmentType === "UNSPECIFIED") {
    warnings.push(
      "This worker has no employment type yet. Set W-2 or 1099 before sending an agreement."
    )
  }

  // Paying someone to be available is a control fact, and control is one of the two
  // factors that decide whether a contractor really is one. Not decisive on its own,
  // and not blocked — the owner classifies, not this system — but it is the single
  // combination most likely to be looked at, so it is said out loud.
  if (options.employmentType === "CONTRACTOR_1099" && timeByBasis.has("ON_SHIFT")) {
    warnings.push(
      "Paying a contractor for time on duty means paying them to be available, which points toward employee. Paying for talk time or completed work does not."
    )
  }

  if (options.employmentType === "W2_EMPLOYEE" && topUpCount === 0) {
    const paysOnlyForProduction =
      timeByBasis.get("ON_SHIFT") === undefined &&
      (timeByBasis.has("TALK") || perEventByName.size > 0 || commissionCount > 0)
    if (paysOnlyForProduction) {
      warnings.push(
        "This W-2 plan only pays for talk time or completed work. Time spent waiting for calls is still hours worked, so add a minimum-wage floor."
      )
    }
  }

  return { errors, warnings }
}

// --- description (contract body, plan editor, portal) ---

function formatUsd(micros: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  }).format(microsToDollars(micros))
}

/** Bare noun — reads correctly after "per". */
function describeEvent(event: PayEventName): string {
  if (event === "ANSWERED_CALL") return "answered call"
  if (event === "BOOKED_JOB") return "booked job"
  return "completed job"
}

/** With an article, for prose that needs one. */
function describeEventWithArticle(event: PayEventName): string {
  return `a${event === "ANSWERED_CALL" ? "n" : ""} ${describeEvent(event)}`
}

function describeUnit(unit: TimeUnit, basis: TimeBasis): string {
  const noun = unit === "SECOND" ? "second" : unit === "MINUTE" ? "minute" : "hour"
  return basis === "TALK" ? `talk ${noun}` : `${noun} on shift`
}

function describeBasis(basis: CommissionBasis): string {
  if (basis === "COLLECTED_TOTAL") return "the total collected"
  if (basis === "LABOR_ONLY") return "labor"
  return "the job subtotal before tax"
}

/**
 * One plain sentence for a component.
 *
 * This is the text that goes into the agreement body, so it has to state the real
 * number a worker will be paid — not a placeholder, and not a rounded approximation
 * of a sub-cent rate.
 */
export function describePayComponent(component: PayComponent): string {
  switch (component.kind) {
    case "TIME": {
      // A per-second rate is fractions of a cent; showing it as "$0.00" would be a lie.
      const digits = component.unit === "SECOND" ? 6 : 2
      const rate = `${formatUsd(component.rate_micros, digits)} per ${describeUnit(component.unit, component.basis)}`
      const floor = component.min_billable_seconds ?? 0
      if (component.basis === "TALK" && floor > 0) {
        return `${rate}, on calls lasting at least ${floor} seconds`
      }
      return rate
    }
    case "PER_EVENT": {
      const amount = `${formatUsd(component.amount_micros)} per ${describeEvent(component.event)}`
      const floor = component.min_billable_seconds ?? 0
      if (component.event === "ANSWERED_CALL" && floor > 0) {
        return `${amount} lasting at least ${floor} seconds`
      }
      return amount
    }
    case "COMMISSION": {
      const pct = (component.rate_bps / 100).toFixed(component.rate_bps % 100 === 0 ? 0 : 2)
      const conditions = CONDITION_ORDER.filter((c) => component.require.includes(c)).map((c) =>
        c.toLowerCase()
      )
      const gate = conditions.length ? ` on jobs that are ${joinWords(conditions)}` : ""
      return `${pct}% of ${describeBasis(component.basis)}${gate}`
    }
    case "MINIMUM_WAGE_TOPUP":
      return `topped up to at least ${formatUsd(component.hourly_floor_micros)} per hour worked`
  }
}

/** Full plan as one sentence, for the agreement and the roster row. */
export function describePayPlan(components: PayComponent[]): string {
  if (components.length === 0) return "No pay plan set"
  return joinWords(components.map(describePayComponent), "plus")
}

function joinWords(parts: string[], conjunction = "and"): string {
  if (parts.length === 0) return ""
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} ${conjunction} ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts[parts.length - 1]}`
}

// --- legacy adapter ---

/**
 * The pay a receptionist row describes, expressed as components.
 *
 * Read only for rows that have no compensation_plans row yet — the same fallback
 * scripts/144 uses to backfill. Reproduces today's behavior exactly, including the
 * 20-second floor that currently applies to both modes as a hard-coded constant.
 */
export function legacyReceptionistComponents(receptionist: {
  pay_mode?: string | null
  rate_per_minute?: number | null
  flat_rate_usd?: number | null
}): PayComponent[] {
  const mode = String(receptionist.pay_mode ?? "PER_MINUTE").trim().toUpperCase()

  if (mode === "FLAT_RATE") {
    return [
      {
        kind: "PER_EVENT",
        event: "ANSWERED_CALL",
        amount_micros: dollarsToMicros(receptionist.flat_rate_usd ?? 2.5),
        min_billable_seconds: DEFAULT_ANSWERED_CALL_MIN_SECONDS,
      },
    ]
  }

  return [
    {
      kind: "TIME",
      unit: "MINUTE",
      basis: "TALK",
      rate_micros: dollarsToMicros(receptionist.rate_per_minute ?? 0.25),
      min_billable_seconds: DEFAULT_ANSWERED_CALL_MIN_SECONDS,
    },
  ]
}

// --- plan row ---

/** A row of compensation_plans (scripts/144). */
export interface CompensationPlan {
  id: string
  owner_user_id: string
  organization_id: string | null
  worker_role: WorkerRole
  receptionist_id: string | null
  field_technician_id: string | null
  worker_user_id: string | null
  employment_type: EmploymentType
  components: PayComponent[]
  currency: string
  effective_from: string
  effective_to: string | null
  superseded_by: string | null
  agreement_id: string | null
  created_by: string | null
  created_at: string
}

/** Which roster row a plan or ledger entry belongs to. */
export type WorkerRef =
  | { role: "receptionist"; receptionist_id: string }
  | { role: "field_tech"; field_technician_id: string }

/** The roster id, whichever kind of worker this is. */
export function workerRefId(ref: WorkerRef): string {
  return ref.role === "receptionist" ? ref.receptionist_id : ref.field_technician_id
}
