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

  try {
    const [jobs, technicians, techLocations] = await Promise.all([
      listOwnerBookedJobs(userId),
      listFieldTechnicians(userId),
      listTechLiveLocations(userId),
    ])
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
    return NextResponse.json({
      data: { jobs, technicians: assignable, techLocations, ownerUserId: userId },
    })
  } catch (e) {
    console.error("[GET /api/owner/jobs] failed:", e)
    return NextResponse.json({ data: { jobs: [], technicians: [], techLocations: [] }, degraded: true })
  }
}
