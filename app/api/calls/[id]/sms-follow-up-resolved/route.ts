// POST /api/calls/[id]/sms-follow-up-resolved — owner handled the missed-call textback
// (called the customer back, booked them, or dismissed it) — clears it from the follow-up queue.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { resolveCallLogSmsFollowUp } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getUserIdFromRequest(req.headers.get("cookie"))
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const callLogId = String(id ?? "").trim()
    if (!callLogId) return NextResponse.json({ error: "Missing call id" }, { status: 400 })

    const ok = await resolveCallLogSmsFollowUp(callLogId, userId)
    if (!ok) return NextResponse.json({ error: "Call not found" }, { status: 404 })

    return NextResponse.json({ data: { resolved: true } })
  } catch (e) {
    console.error("[POST /api/calls/[id]/sms-follow-up-resolved]", e)
    return NextResponse.json({ error: "Failed to resolve follow-up" }, { status: 500 })
  }
}
