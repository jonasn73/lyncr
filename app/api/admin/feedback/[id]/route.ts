// ============================================
// PATCH /api/admin/feedback/[id]
// ============================================
// Update triage status (open | triaged | closed).

import { NextRequest, NextResponse } from "next/server"
import { updateFeedbackSubmissionStatusAdmin } from "@/lib/db"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"
import type { FeedbackStatus } from "@/lib/types"

const STATUSES: FeedbackStatus[] = ["open", "triaged", "closed"]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  try {
    const body = await req.json()
    const status = String(body?.status ?? "").trim() as FeedbackStatus
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    const updated = await updateFeedbackSubmissionStatusAdmin(id, status)
    if (!updated) {
      return NextResponse.json({ error: "Not found or feedback table missing" }, { status: 404 })
    }
    return NextResponse.json({ data: updated })
  } catch (e) {
    console.error("[lyncr] admin feedback PATCH:", e)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}
