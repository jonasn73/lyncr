// ============================================
// GET /api/owner/booking-alerts?since=<ISO>
// ============================================
// Lightweight poll for the Business Owner dashboard: returns BOOKED jobs an operator logged after
// `since`, so the Activity view can fire a live toast + audio ping. Defaults to the last 60s when no
// `since` is supplied. Owner-scoped via the session user id.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listRecentBookedLeads } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const sinceParam = req.nextUrl.searchParams.get("since")?.trim()
  const sinceMs = sinceParam ? Date.parse(sinceParam) : NaN
  const sinceIso = Number.isFinite(sinceMs)
    ? new Date(sinceMs).toISOString()
    : new Date(Date.now() - 60_000).toISOString()

  try {
    const leads = await listRecentBookedLeads(userId, sinceIso)
    return NextResponse.json({
      data: {
        bookings: leads.map((l) => ({
          id: l.id,
          caller: l.caller_e164,
          summary: l.summary,
          created_at: l.created_at,
        })),
        now: new Date().toISOString(),
      },
    })
  } catch (e) {
    console.error("[owner/booking-alerts GET]", e)
    return NextResponse.json({ data: { bookings: [], now: new Date().toISOString() } })
  }
}
