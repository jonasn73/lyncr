// GET /api/cron/sweep-unsettled-calls — every 15 minutes: catch earnings-ledger rows a
// webhook's fire-and-forget settlement attempt missed (settleCallEarningsInBackground in
// lib/compensation/settle-call.ts never throws and never retries on its own — its own
// comment promises "the next sweep picks it up", but nothing was actually scheduled to be
// that sweep until this cron; sweepUnsettledCalls itself was only ever wired into the
// one-off scripts/backfill-earnings-ledger.ts). Idempotent — a call already settled inserts
// nothing, so a wide rolling lookback window is safe to re-scan every run.

import { NextRequest, NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/lib/cron-auth"
import { sweepUnsettledCalls } from "@/lib/compensation/settle-call"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const endIso = new Date().toISOString()
    const startIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = await sweepUnsettledCalls({ startIso, endIso })
    if (result.inserted > 0) {
      console.log(
        JSON.stringify({
          lyncr: "cron-sweep-unsettled-calls",
          ...result,
        })
      )
    }
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[cron/sweep-unsettled-calls]", e)
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 })
  }
}
