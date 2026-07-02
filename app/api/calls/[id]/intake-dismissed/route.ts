// POST /api/calls/[id]/intake-dismissed — owner closed or dispatched the answered-call intake sheet.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { markCallLogOwnerIntakeDismissed } from "@/lib/db"

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

    const ok = await markCallLogOwnerIntakeDismissed(userId, callLogId)
    if (!ok) return NextResponse.json({ error: "Call not found" }, { status: 404 })

    return NextResponse.json({ data: { dismissed: true } })
  } catch (e) {
    console.error("[POST /api/calls/[id]/intake-dismissed]", e)
    return NextResponse.json({ error: "Failed to dismiss intake" }, { status: 500 })
  }
}
