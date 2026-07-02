// GET /api/calls/ringing-recent — inbound calls still ringing (intake sheet opens early).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listRecentlyRingingIncomingCalls } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const mins = Number(req.nextUrl.searchParams.get("withinMinutes") || "5")
    const within = Number.isFinite(mins) ? Math.min(Math.max(mins, 1), 15) : 5
    const calls = await listRecentlyRingingIncomingCalls(userId, within)
    return NextResponse.json({ calls })
  } catch (e) {
    console.error("[GET /api/calls/ringing-recent]", e)
    return NextResponse.json({ error: "Failed to load calls", calls: [] }, { status: 500 })
  }
}
