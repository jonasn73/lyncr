// ============================================
// GET /api/owner/jobs
// ============================================
// Booked jobs for the owner's dispatch feed + the active technician roster (for the Assign dropdown).

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listFieldTechnicians, listOwnerBookedJobs, listTechLiveLocations } from "@/lib/db"
import { flushDueScheduledSms } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  // Isolate failures: a missing tech column must never wipe booked job pins.
  const [jobsResult, techniciansResult, techLocationsResult] = await Promise.allSettled([
    listOwnerBookedJobs(userId),
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
    data: { jobs, technicians: assignable, techLocations, ownerUserId: userId },
    ...(degraded ? { degraded: true } : {}),
  })
}
