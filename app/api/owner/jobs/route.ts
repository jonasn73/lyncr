// ============================================
// GET /api/owner/jobs
// ============================================
// Booked jobs for the owner's dispatch feed + the active technician roster (for the Assign dropdown).
// Query: scope=map → active field jobs + tech roster/GPS.
// Query: scope=collect → active field jobs only (fast path for Collect Payment).

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  listFieldTechnicians,
  listOwnerBookedJobs,
  listOwnerMapLeadPins,
  listTechLiveLocations,
} from "@/lib/db"
import { flushDueScheduledSms } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const scope = req.nextUrl.searchParams.get("scope")?.trim().toLowerCase() || "all"
  const activeOnly = scope === "map" || scope === "collect"
  const leadsOnly = scope === "leads"
  // Collect Payment only needs open jobs — skip tech roster / GPS (faster cold start).
  const jobsOnly = scope === "collect"

  if (jobsOnly) {
    try {
      const jobs = await listOwnerBookedJobs(userId, 50, { activeOnly: true })
      return NextResponse.json({
        data: { jobs, technicians: [], techLocations: [], ownerUserId: userId, scope },
      })
    } catch (e) {
      console.error("[GET /api/owner/jobs] collect jobs failed:", e)
      return NextResponse.json({
        data: { jobs: [], technicians: [], techLocations: [], ownerUserId: userId, scope },
        degraded: true,
      })
    }
  }

  // Isolate failures: a missing tech column must never wipe booked job pins.
  const [jobsResult, techniciansResult, techLocationsResult] = await Promise.allSettled([
    leadsOnly
      ? listOwnerMapLeadPins(userId)
      : listOwnerBookedJobs(userId, 50, { activeOnly }),
    listFieldTechnicians(userId),
    listTechLiveLocations(userId),
  ])

  const jobs = jobsResult.status === "fulfilled" ? jobsResult.value : []
  const technicians = techniciansResult.status === "fulfilled" ? techniciansResult.value : []
  const techLocations = techLocationsResult.status === "fulfilled" ? techLocationsResult.value : []

  if (jobsResult.status === "rejected") {
    console.error("[GET /api/owner/jobs] jobs failed:", jobsResult.reason)
  }
  if (techniciansResult.status === "rejected") {
    console.error("[GET /api/owner/jobs] technicians failed:", techniciansResult.reason)
  }
  if (techLocationsResult.status === "rejected") {
    console.error("[GET /api/owner/jobs] techLocations failed:", techLocationsResult.reason)
  }

  // Backstop the scheduler: flush any due review texts whenever the dispatch feed is open.
  after(async () => {
    try {
      await flushDueScheduledSms()
    } catch {
      /* best-effort */
    }
  })

  // Only techs that have a usable login are assignable.
  const assignable = technicians.filter((t) => t.is_active && t.portal_user_id)
  const degraded =
    jobsResult.status === "rejected" ||
    techniciansResult.status === "rejected" ||
    techLocationsResult.status === "rejected"

  return NextResponse.json({
    data: { jobs, technicians: assignable, techLocations, ownerUserId: userId, scope },
    ...(degraded ? { degraded: true } : {}),
  })
}
