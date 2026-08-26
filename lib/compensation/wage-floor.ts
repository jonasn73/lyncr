// ============================================
// Minimum-wage floor — applied one workweek at a time
// ============================================
// Ties the three pieces together: what a worker earned in a week (earnings_ledger),
// how long they were on the clock (work_shifts), and the floor their plan carries.
//
// The unit is the workweek, not the pay period. The FLSA takes a single workweek as
// its standard and does not permit averaging across two or more, so a fortnight
// containing one good week and one dead one owes a top-up for the dead week even
// though the fortnight as a whole clears the floor.
//
// This is a floor, not payroll. It does not compute overtime — the regular rate for a
// worker earning commission requires allocating that commission back across the
// workweeks it was earned in, and premium pay belongs to a payroll provider.

import {
  calculateMinimumWageTopUp,
  splitIntoWorkweeks,
  type EarningLine,
} from "@/lib/compensation/calculate"
import { getEarningsTotal, recordEarningLines } from "@/lib/compensation/ledger"
import { getPlanInForceAt } from "@/lib/compensation/plans"
import { shiftSecondsInWindow } from "@/lib/compensation/shifts"
import type { WorkerRef } from "@/lib/compensation/plan-schema"

/** One week's worth of the floor calculation, whether or not anything was owed. */
export interface WorkweekFloorResult {
  startIso: string
  endIso: string
  onShiftSeconds: number
  earnedCents: number
  topUpCents: number
}

/**
 * A stable id for a worker's workweek, used as the ledger's dedupe key.
 *
 * Must be unique per worker per week: a pay-period id shared across the weeks inside
 * it would collide on the dedupe index and silently drop the second week's top-up.
 * Not a UUID — earnings_ledger.source_id is deliberately un-foreign-keyed, and a
 * readable key makes a row explain itself.
 */
export function workweekSourceId(ref: WorkerRef, startIso: string): string {
  const worker = ref.role === "receptionist" ? ref.receptionist_id : ref.field_technician_id
  return `${worker}:${startIso.slice(0, 10)}`
}

/**
 * Apply the floor across every workweek in a period.
 *
 * `dryRun` computes without writing, which is what the owner's pay-period preview
 * needs — seeing what a period will cost should not itself create a liability.
 */
export async function applyWageFloorForPeriod(params: {
  ownerUserId: string
  organizationId?: string | null
  ref: WorkerRef
  workerUserId?: string | null
  periodStartIso: string
  periodEndIso: string
  /** Employer's declared start of the workweek. 0 = Sunday. */
  weekStartDay?: number
  dryRun?: boolean
}): Promise<{ weeks: WorkweekFloorResult[]; totalTopUpCents: number; inserted: number }> {
  const weeks = splitIntoWorkweeks(
    params.periodStartIso,
    params.periodEndIso,
    params.weekStartDay ?? 0
  )

  const results: WorkweekFloorResult[] = []
  let totalTopUpCents = 0
  let inserted = 0

  for (const week of weeks) {
    // The plan as it stood at the end of the week — the same rule settlement uses.
    const plan = await getPlanInForceAt(params.ref, week.endIso)
    if (!plan || plan.employment_type !== "W2_EMPLOYEE") continue
    if (!plan.components.some((c) => c.kind === "MINIMUM_WAGE_TOPUP")) continue

    const [onShiftSeconds, earned] = await Promise.all([
      shiftSecondsInWindow(params.ref, week.startIso, week.endIso),
      getEarningsTotal(params.ref, week.startIso, week.endIso),
    ])

    const sourceId = workweekSourceId(params.ref, week.startIso)

    // Exclude any top-up already written for this week, or a second run would compare
    // the topped-up total against the floor and conclude nothing more is owed —
    // correct by luck this time, wrong as soon as hours are corrected upward.
    const priorTopUp = await topUpAlreadyWritten(params.ref, week, sourceId)
    const earnedExcludingTopUp = earned.cents - priorTopUp

    const line = calculateMinimumWageTopUp({
      components: plan.components,
      weekEarnedCents: earnedExcludingTopUp,
      onShiftSeconds,
      workweekId: sourceId,
      earnedAt: week.endIso,
    })

    const topUpCents = line?.amount_cents ?? 0
    results.push({
      startIso: week.startIso,
      endIso: week.endIso,
      onShiftSeconds,
      earnedCents: earnedExcludingTopUp,
      topUpCents,
    })
    totalTopUpCents += topUpCents

    if (line && !params.dryRun && topUpCents > priorTopUp) {
      inserted += await recordEarningLines({
        ownerUserId: params.ownerUserId,
        organizationId: params.organizationId,
        ref: params.ref,
        workerUserId: params.workerUserId,
        planId: plan.id,
        lines: [line as EarningLine],
      })
    }
  }

  return { weeks: results, totalTopUpCents, inserted }
}

/** Top-up cents already on the ledger for this workweek. */
async function topUpAlreadyWritten(
  ref: WorkerRef,
  week: { startIso: string; endIso: string },
  sourceId: string
): Promise<number> {
  const { listEarnings } = await import("@/lib/compensation/ledger")
  const rows = await listEarnings(ref, week.startIso, week.endIso)
  return rows
    .filter((row) => row.component_kind === "MINIMUM_WAGE_TOPUP" && row.source_id === sourceId)
    .reduce((sum, row) => sum + row.amount_cents, 0)
}
