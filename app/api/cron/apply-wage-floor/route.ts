// GET /api/cron/apply-wage-floor — weekly: pay the minimum-wage top-up owed for the
// workweek that just ended.
//
// Without this, a W-2 plan carrying a floor is a promise in a signed agreement that
// nothing keeps: the contract says "if your pay works out to less than $X per hour for
// the hours you worked that week, the Company will pay you the difference", and the
// difference was never computed.
//
// Deliberately weekly and one week behind, not per pay period. The FLSA takes a single
// workweek as its standard and does not permit averaging across two or more, so each
// week is settled on its own as soon as it closes. Running it a week behind means the
// week's calls and shifts have all landed before it is judged.

import { NextRequest, NextResponse } from "next/server"
import { listPlansWithWageFloor } from "@/lib/compensation/plans"
import { applyWageFloorForPeriod } from "@/lib/compensation/wage-floor"
import type { WorkerRef } from "@/lib/compensation/plan-schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The workweek that most recently closed, on the employer's week boundary.
 *
 * Defaults to a Sunday start, matching splitIntoWorkweeks. When employers can declare
 * their own boundary this should read it per owner rather than assuming.
 */
function lastClosedWorkweek(now: Date, weekStartDay = 0): { startIso: string; endIso: string } {
  const daysSinceStart = (now.getUTCDay() - weekStartDay + 7) % 7
  const thisWeekStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceStart
  )
  return {
    startIso: new Date(thisWeekStart - WEEK_MS).toISOString(),
    endIso: new Date(thisWeekStart).toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) {
    const auth = req.headers.get("authorization") || ""
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const week = lastClosedWorkweek(new Date())

  try {
    const plans = await listPlansWithWageFloor()
    let workersToppedUp = 0
    let rowsWritten = 0
    let totalCents = 0

    for (const plan of plans) {
      const ref: WorkerRef =
        plan.worker_role === "receptionist"
          ? { role: "receptionist", receptionist_id: plan.receptionist_id ?? "" }
          : { role: "field_tech", field_technician_id: plan.field_technician_id ?? "" }

      try {
        const result = await applyWageFloorForPeriod({
          ownerUserId: plan.owner_user_id,
          organizationId: plan.organization_id,
          ref,
          workerUserId: plan.worker_user_id,
          periodStartIso: week.startIso,
          periodEndIso: week.endIso,
        })
        if (result.inserted > 0) workersToppedUp += 1
        rowsWritten += result.inserted
        totalCents += result.totalTopUpCents
      } catch (e) {
        // One worker's bad data must not stop everyone else's floor being paid.
        console.error("[cron/apply-wage-floor] worker failed:", plan.id, e)
      }
    }

    // Always logged, including a zero run: "nobody was underpaid last week" and "the
    // sweep never ran" look identical from the ledger otherwise.
    console.log(
      JSON.stringify({
        zing: "compensation-wage-floor-swept",
        week: week.startIso,
        plans: plans.length,
        workersToppedUp,
        rowsWritten,
        totalCents,
      })
    )

    return NextResponse.json({
      data: { week, plans: plans.length, workersToppedUp, rowsWritten, totalCents },
    })
  } catch (e) {
    console.error("[cron/apply-wage-floor]", e)
    return NextResponse.json({ error: "Wage floor sweep failed" }, { status: 500 })
  }
}
