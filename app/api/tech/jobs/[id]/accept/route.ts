// PATCH /api/tech/jobs/[id]/accept — tech acknowledges a dispatched job.
// Acknowledgment only: never gates Start Route or any other action. Idempotent.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { acceptJobForTech } from "@/lib/db"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  const actor = await resolveActor(req.headers.get("cookie"), { allowFieldTech: true })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — scoped to their own assigned job.
  const userId = actor.actingUserId

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  try {
    const ok = await acceptJobForTech(userId, leadId.trim())
    if (!ok) return NextResponse.json({ error: "Job not found or not assigned to you" }, { status: 404 })
    return NextResponse.json({ data: { id: leadId.trim(), accepted: true } })
  } catch (e) {
    console.error("[PATCH /api/tech/jobs/[id]/accept]", e)
    return NextResponse.json({ error: "Could not accept job" }, { status: 500 })
  }
}
