// POST /api/owner/jobs/[id]/thanks-review — queue thank-you + review SMS for a finished job.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getOwnerSchedulerEventById } from "@/lib/db"
import { onJobStateChange } from "@/lib/sms-pipeline"

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
    const result = await onJobStateChange("COMPLETED", {
      leadId: leadId.trim(),
      expectedOwnerUserId: userId,
      techName: event.assigned_tech_name,
    })
    if (!result.ok && result.skipped) {
      return NextResponse.json(
        {
          error:
            result.reason === "phase-disabled"
              ? "Review SMS is turned off in SMS templates."
              : result.reason === "no-review-url"
                ? "Add a Google review URL in SMS templates first."
                : "Could not queue thank-you SMS.",
          reason: result.reason,
        },
        { status: 400 }
      )
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Could not queue thank-you SMS." }, { status: 500 })
    }
    return NextResponse.json({ data: { ok: true, leadId: leadId.trim() } })
  } catch (e) {
    console.error("[POST /api/owner/jobs/[id]/thanks-review]", e)
    return NextResponse.json({ error: "Could not queue thank-you SMS." }, { status: 500 })
  }
}
