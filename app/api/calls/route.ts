// ============================================
// GET /api/calls
// ============================================
// Returns call history for the dashboard and activity pages.
// Supports filtering by type and pagination.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getCallLogs } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const type = searchParams.get("type") || undefined // incoming, outgoing, missed, voicemail

    const calls = await getCallLogs(userId, { limit, offset, type })

    return NextResponse.json({ calls })
  } catch (error) {
    console.error("[Sigo] Error fetching calls:", error)
    return NextResponse.json(
      { error: "Failed to fetch call logs" },
      { status: 500 }
    )
  }
}
