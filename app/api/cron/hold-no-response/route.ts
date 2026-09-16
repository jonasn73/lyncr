// GET /api/cron/hold-no-response — every 5 minutes: both hold follow-up sweeps.
//
// 1. Closed-hours no-response expectation-setter: a caller who out-waited the
//    hold got a booking link; if the owner hasn't responded within the wait
//    window, tell the customer the team is unavailable until the next scheduled
//    opening (honest + door open) instead of leaving them up at 1 AM expecting
//    a call.
// 2. Abandoned-hold rescue: a caller who hung up mid-hold gets the booking link
//    a few minutes later (92% previously got nothing, links convert ~45%).

import { NextRequest, NextResponse } from "next/server"
import { runHoldNoResponseFollowupSweep } from "@/lib/hold-no-response-followup"
import { runAbandonedHoldRescueSweep } from "@/lib/abandoned-hold-rescue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) {
    const auth = req.headers.get("authorization") || ""
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  try {
    // Sequential on purpose: both touch the same call_queue marker column, and
    // their status filters are disjoint ('left' vs timed_out/sms_left), so this
    // is about keeping DB pressure flat, not correctness.
    const noResponse = await runHoldNoResponseFollowupSweep()
    const abandonRescue = await runAbandonedHoldRescueSweep()
    return NextResponse.json({ data: { noResponse, abandonRescue } })
  } catch (e) {
    console.error("[cron/hold-no-response]", e)
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 })
  }
}
