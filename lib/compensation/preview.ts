// ============================================
// What would this pay plan have cost?
// ============================================
// Replays a proposed plan against a worker's real history — the calls they actually
// answered, the jobs they actually completed — so an owner can see a number before
// they sign someone to it.
//
// Reads call_logs and ai_leads directly rather than the earnings ledger, because the
// whole point is to price a plan that has never been in force and therefore has no
// ledger rows. Nothing here writes.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  calculateEarnings,
  calculateMinimumWageTopUp,
  splitIntoWorkweeks,
  sumEarningCents,
  type CallPayEvent,
  type EarningLine,
  type JobPayEvent,
} from "@/lib/compensation/calculate"
import { resolveJobCommissionBase } from "@/lib/compensation/job-value"
import { shiftSecondsInWindow } from "@/lib/compensation/shifts"
import {
  MICROS_PER_CENT,
  type EmploymentType,
  type PayComponent,
  type WorkerRef,
} from "@/lib/compensation/plan-schema"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

/** Jobs priced per preview. Enough to be representative without a slow page. */
const MAX_JOBS_PRICED = 100

export interface PlanCostPreview {
  windowDays: number
  /** Answered calls in the window, and what the plan would pay for them. */
  calls: { count: number; talkSeconds: number; cents: number }
  /** Completed, paid jobs in the window, and what the plan would pay for them. */
  jobs: { count: number; cents: number; capped: boolean }
  /** Everything the worker would have earned by producing. */
  productionCents: number
  floor: {
    /** Whether a floor could be estimated at all. */
    available: boolean
    /** Why not, when it could not. */
    reason?: string
    /** Hours per week the estimate assumed, and where that number came from. */
    weeklyHours: number
    hoursSource: "tracked" | "assumed"
    weeks: number
    topUpCents: number
  }
  /** Production plus any floor top-up — what the plan actually costs. */
  totalCents: number
  /** Total divided by the hours it assumed. Null when there are no hours. */
  effectiveHourlyCents: number | null
}

interface CallRow {
  id: string
  answered_at: string
  ended_at: string
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

/** Answered calls with resolvable talk time, newest first. */
async function loadCalls(receptionistId: string, startIso: string): Promise<CallRow[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id, answered_at, ended_at
      FROM call_logs
      WHERE routed_to_receptionist_id = ${receptionistId}
        AND answered_at IS NOT NULL
        AND ended_at IS NOT NULL
        AND ended_at > answered_at
        AND lower(status) IN ('answered', 'completed', 'in-progress')
        AND ended_at >= ${startIso}::timestamptz
      ORDER BY ended_at DESC
      LIMIT 5000
    `) as Record<string, unknown>[]
    return rows.flatMap((row) => {
      const answered = isoOrNull(row.answered_at)
      const ended = isoOrNull(row.ended_at)
      if (!answered || !ended) return []
      return [{ id: String(row.id), answered_at: answered, ended_at: ended }]
    })
  } catch {
    return []
  }
}

/** Completed jobs for a tech in the window. */
async function loadTechJobs(technicianId: string, startIso: string): Promise<string[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT l.id
      FROM ai_leads l
      JOIN field_technicians ft
        ON ft.portal_user_id = l.assigned_tech_id AND ft.user_id = l.user_id
      WHERE ft.id = ${technicianId}
        AND lower(COALESCE(l.job_status, '')) = 'completed'
        AND l.created_at >= ${startIso}::timestamptz
      ORDER BY l.created_at DESC
      LIMIT ${MAX_JOBS_PRICED + 1}
    `) as Record<string, unknown>[]
    return rows.map((row) => String(row.id))
  } catch {
    return []
  }
}

/** Jobs a receptionist is credited with booking. */
async function loadBookedJobs(receptionistId: string, startIso: string): Promise<string[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id FROM ai_leads
      WHERE booked_by_receptionist_id = ${receptionistId}
        AND COALESCE(booking_attribution_inferred, false) = false
        AND lower(COALESCE(job_status, '')) = 'completed'
        AND created_at >= ${startIso}::timestamptz
      ORDER BY created_at DESC
      LIMIT ${MAX_JOBS_PRICED + 1}
    `) as Record<string, unknown>[]
    return rows.map((row) => String(row.id))
  } catch {
    // Pre-149 — no attribution column, so no booked jobs to price.
    return []
  }
}

/**
 * Price a plan against a worker's real history.
 *
 * `assumedWeeklyHours` is what makes the floor answerable before the shift clock has
 * any data: an owner deciding whether to attach a wage floor needs to know what it
 * would cost at, say, ten hours a week. Tracked hours are used instead wherever they
 * exist, and the result says which it used so the number is never mistaken for a
 * measurement.
 */
export async function previewPlanCost(params: {
  ref: WorkerRef
  components: PayComponent[]
  employmentType: EmploymentType
  windowDays?: number
  assumedWeeklyHours?: number
}): Promise<PlanCostPreview> {
  const windowDays = Math.min(Math.max(1, params.windowDays ?? 30), 365)
  const endIso = new Date().toISOString()
  const startIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const lines: EarningLine[] = []
  let callCount = 0
  let talkSeconds = 0
  let callCents = 0

  if (params.ref.role === "receptionist") {
    const calls = await loadCalls(params.ref.receptionist_id, startIso)
    for (const call of calls) {
      const seconds = Math.max(
        0,
        Math.round((Date.parse(call.ended_at) - Date.parse(call.answered_at)) / 1000)
      )
      if (seconds <= 0) continue
      callCount += 1
      talkSeconds += seconds
      const event: CallPayEvent = {
        kind: "CALL",
        id: call.id,
        occurred_at: call.ended_at,
        answered: true,
        talk_seconds: seconds,
      }
      const callLines = calculateEarnings(params.components, event)
      callCents += sumEarningCents(callLines)
      lines.push(...callLines)
    }
  }

  // Only price jobs when the plan has something that pays on one — otherwise every
  // preview pays for resolving job values it will never use.
  const paysOnJobs = params.components.some(
    (c) => c.kind === "COMMISSION" || (c.kind === "PER_EVENT" && c.event !== "ANSWERED_CALL")
  )

  let jobIds: string[] = []
  if (paysOnJobs) {
    jobIds =
      params.ref.role === "field_tech"
        ? await loadTechJobs(params.ref.field_technician_id, startIso)
        : await loadBookedJobs(params.ref.receptionist_id, startIso)
  }
  const capped = jobIds.length > MAX_JOBS_PRICED
  const pricedJobIds = jobIds.slice(0, MAX_JOBS_PRICED)

  let jobCents = 0
  for (const jobId of pricedJobIds) {
    const value = await resolveJobCommissionBase(jobId)
    const event: JobPayEvent = {
      kind: "JOB",
      id: jobId,
      occurred_at: endIso,
      booked: true,
      completed: true,
      // These are completed jobs from history; pricing them as paid is what makes the
      // preview an estimate of a full month rather than of collections timing.
      paid: true,
      base_cents: value.cents,
    }
    const jobLines = calculateEarnings(params.components, event)
    jobCents += sumEarningCents(jobLines)
    lines.push(...jobLines)
  }

  const productionCents = callCents + jobCents

  // --- the floor ---
  const weeks = splitIntoWorkweeks(startIso, endIso)
  const hasFloor = params.components.some((c) => c.kind === "MINIMUM_WAGE_TOPUP")
  const trackedSeconds = await shiftSecondsInWindow(params.ref, startIso, endIso).catch(() => 0)
  const weekCount = Math.max(1, weeks.length)

  let floor: PlanCostPreview["floor"] = {
    available: false,
    weeklyHours: 0,
    hoursSource: "assumed",
    weeks: weekCount,
    topUpCents: 0,
  }

  if (!hasFloor) {
    floor.reason =
      params.employmentType === "W2_EMPLOYEE"
        ? "No minimum-wage floor on this plan."
        : "A minimum-wage floor does not apply to a contractor."
  } else if (params.employmentType !== "W2_EMPLOYEE") {
    floor.reason = "A minimum-wage floor does not apply to a contractor."
  } else {
    const trackedWeeklyHours = trackedSeconds / 3600 / weekCount
    const weeklyHours =
      trackedSeconds > 0 ? trackedWeeklyHours : Math.max(0, params.assumedWeeklyHours ?? 0)
    const hoursSource: "tracked" | "assumed" = trackedSeconds > 0 ? "tracked" : "assumed"

    if (weeklyHours <= 0) {
      floor.reason = "Set how many hours a week they'd be on duty to estimate this."
    } else {
      // Per workweek, not across the period — a good week must not absorb a dead one.
      // Production is spread evenly here, which is the honest simplification: the real
      // calculation uses each week's own earnings, and only the settled ledger knows those.
      const perWeekProductionCents = Math.round(productionCents / weekCount)
      let topUpCents = 0
      for (const week of weeks) {
        const line = calculateMinimumWageTopUp({
          components: params.components,
          weekEarnedCents: perWeekProductionCents,
          onShiftSeconds: Math.round(weeklyHours * 3600),
          workweekId: `preview:${week.startIso}`,
          earnedAt: week.endIso,
        })
        topUpCents += line?.amount_cents ?? 0
      }
      floor = {
        available: true,
        weeklyHours: Math.round(weeklyHours * 10) / 10,
        hoursSource,
        weeks: weekCount,
        topUpCents,
      }
    }
  }

  const totalCents = productionCents + floor.topUpCents
  const totalHours = floor.weeklyHours * weekCount
  const effectiveHourlyCents = totalHours > 0 ? Math.round(totalCents / totalHours) : null

  return {
    windowDays,
    calls: { count: callCount, talkSeconds, cents: callCents },
    jobs: { count: pricedJobIds.length, cents: jobCents, capped },
    productionCents,
    floor,
    totalCents,
    effectiveHourlyCents,
  }
}

/** Hourly value of a rate expressed in micros per second, for display. */
export function centsPerHourFromMicros(rateMicrosPerSecond: number): number {
  return Math.round((rateMicrosPerSecond * 3600) / MICROS_PER_CENT)
}
