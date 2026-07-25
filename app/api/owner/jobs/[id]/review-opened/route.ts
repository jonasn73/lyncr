// POST /api/owner/jobs/[id]/review-opened — owner marks that the customer opened/left a review.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerSchedulerEventById, markLeadReviewLinkOpened } from "@/lib/db"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteContext) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  const event = await getOwnerSchedulerEventById(userId, leadId.trim())
  if (!event) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  try {
    const ok = await markLeadReviewLinkOpened({
      leadId: leadId.trim(),
      ownerUserId: userId,
    })
    if (!ok) return NextResponse.json({ error: "Could not update job" }, { status: 500 })
    return NextResponse.json({ data: { ok: true, leadId: leadId.trim() } })
  } catch (e) {
    console.error("[POST /api/owner/jobs/[id]/review-opened]", e)
    return NextResponse.json({ error: "Could not mark review opened" }, { status: 500 })
  }
}
