// GET /api/owner/jobs/pool — unassigned hopper jobs for the active workspace

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listOwnerUnassignedPoolJobs } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
  const orgId = organizationId && !organizationId.startsWith("legacy-") ? organizationId : null

  try {
    const jobs = await listOwnerUnassignedPoolJobs({
      ownerUserId: userId,
      organizationId: orgId,
    })
    return NextResponse.json({ data: { jobs } })
  } catch (e) {
    console.error("[GET /api/owner/jobs/pool]", e)
    return NextResponse.json({ data: { jobs: [] }, degraded: true })
  }
}
