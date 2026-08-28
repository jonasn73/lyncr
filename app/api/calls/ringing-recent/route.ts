// GET /api/calls/ringing-recent — inbound calls still ringing (intake sheet opens early).

import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import { listRecentlyRingingIncomingCalls } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveWorkspaceActor(req.headers.get("cookie"))
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = actor.ownerUserId
    const mins = Number(req.nextUrl.searchParams.get("withinMinutes") || "5")
    const within = Number.isFinite(mins) ? Math.min(Math.max(mins, 1), 15) : 5
    const calls = await listRecentlyRingingIncomingCalls(userId, within)
    return NextResponse.json({ calls })
  } catch (e) {
    console.error("[GET /api/calls/ringing-recent]", e)
    return NextResponse.json({ error: "Failed to load calls", calls: [] }, { status: 500 })
  }
}
