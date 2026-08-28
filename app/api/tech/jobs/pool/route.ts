// GET /api/tech/jobs/pool — unassigned hopper jobs the tech can claim

import { NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getUser, listUnassignedPoolForTech } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "job_pool" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId

  try {
    const jobs = await listUnassignedPoolForTech(userId)
    return NextResponse.json({ data: { jobs } })
  } catch (e) {
    console.error("[GET /api/tech/jobs/pool]", e)
    return NextResponse.json({ data: { jobs: [] }, degraded: true })
  }
}
