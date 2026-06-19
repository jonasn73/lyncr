// GET /api/tech/jobs/pool — unassigned hopper jobs the tech can claim

import { NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, listUnassignedPoolForTech } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const jobs = await listUnassignedPoolForTech(userId)
    return NextResponse.json({ data: { jobs } })
  } catch (e) {
    console.error("[GET /api/tech/jobs/pool]", e)
    return NextResponse.json({ data: { jobs: [] }, degraded: true })
  }
}
