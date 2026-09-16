// GET /api/cron/hold-no-response — every 5 minutes: closed-hours expectation-setter.
//
// A closed-hours caller who out-waited the hold already got a booking link, and
// the owner keeps the option of waking up and taking the job. When the owner
// hasn't responded within the wait window, this texts the customer that the team
// is unavailable until the next scheduled opening (honest + door open) instead
// of leaving them up at 1 AM expecting a call.

import { NextRequest, NextResponse } from "next/server"
import { runHoldNoResponseFollowupSweep } from "@/lib/hold-no-response-followup"

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
    const result = await runHoldNoResponseFollowupSweep()
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[cron/hold-no-response]", e)
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 })
  }
}
