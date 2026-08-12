// ============================================
// GET /api/calls/queue — waiting hold-queue callers for Lines
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getHoldQueueDayStats, listWaitingCallQueue } from "@/lib/call-queue-db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Sweep first, then read list + stats — avoids a race where stats still count ghosts.
    const waiting = await listWaitingCallQueue(userId)
    const stats = await getHoldQueueDayStats(userId).catch(() => null)
    return NextResponse.json({
      data: {
        count: waiting.length,
        callers: waiting.map((w) => ({
          id: w.id,
          callControlId: w.call_control_id,
          callerE164: w.caller_e164,
          businessLineE164: w.business_line_e164,
          status: w.status,
          enqueuedAt: w.enqueued_at,
          queueName: w.queue_name,
        })),
        // Subtle Lines rollup — wait / Answer / press-1 / abandon (today).
        stats: stats
          ? {
              waiting: stats.waiting,
              answered: stats.answered,
              press1: stats.press1,
              abandoned: stats.abandoned,
              avgWaitSecs: stats.avgWaitSecs,
            }
          : null,
      },
    })
  } catch (e) {
    console.error("[GET /api/calls/queue]", e)
    return NextResponse.json(
      { error: "Failed to load hold queue", data: { count: 0, callers: [], stats: null } },
      { status: 500 }
    )
  }
}
