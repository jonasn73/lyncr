// PATCH /api/tech/jobs/[id]/claim — field tech claims a hopper job

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { claimUnassignedJobForTech, getUser } from "@/lib/db"
import { publishOwnerEvent, publishTechnicianEvent } from "@/lib/realtime/pusher-server"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "job_pool" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  try {
    const result = await claimUnassignedJobForTech(userId, leadId.trim())
    if (!result.ok) {
      return NextResponse.json({ error: "Job not available or already claimed" }, { status: 409 })
    }

    if (result.ownerUserId) {
      await publishOwnerEvent(result.ownerUserId, "job-assigned", {
        leadId: leadId.trim(),
        techUserId: userId,
      }).catch(() => {})
    }
    await publishTechnicianEvent(userId, "job-assigned", { leadId: leadId.trim() }).catch(() => {})

    return NextResponse.json({
      data: { id: leadId.trim(), status: "dispatched", assigned_tech_id: userId },
    })
  } catch (e) {
    console.error("[PATCH /api/tech/jobs/[id]/claim]", e)
    return NextResponse.json({ error: "Could not claim job" }, { status: 500 })
  }
}
