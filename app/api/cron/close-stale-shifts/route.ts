// GET /api/cron/close-stale-shifts — every 10 minutes: end shifts nobody ended.
//
// The most common way a shift ends is a closed laptop, not a tapped toggle. Left
// alone, that shift accrues hourly pay all night and inflates the hours the
// minimum-wage floor divides by. Each one is closed at the worker's last heartbeat,
// so the quiet gap is never paid.

import { NextRequest, NextResponse } from "next/server"
import { sweepStaleShifts } from "@/lib/compensation/shifts"

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
    const result = await sweepStaleShifts()
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[cron/close-stale-shifts]", e)
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 })
  }
}
