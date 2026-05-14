// ============================================
// GET /api/admin/feedback
// ============================================
// Newest feedback submissions for triage.

import { NextRequest, NextResponse } from "next/server"
import { listFeedbackSubmissionsForAdmin } from "@/lib/db"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const limitRaw = req.nextUrl.searchParams.get("limit")
  const limit = limitRaw != null ? Number(limitRaw) : 100
  const items = await listFeedbackSubmissionsForAdmin(Number.isFinite(limit) ? limit : 100)
  return NextResponse.json({ data: { items } })
}
