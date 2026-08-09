// ============================================
// GET /api/calls/queue — waiting hold-queue callers for Lines
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listWaitingCallQueue } from "@/lib/call-queue-db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const waiting = await listWaitingCallQueue(userId)
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
      },
    })
  } catch (e) {
    console.error("[GET /api/calls/queue]", e)
    return NextResponse.json({ error: "Failed to load hold queue", data: { count: 0, callers: [] } }, { status: 500 })
  }
}
