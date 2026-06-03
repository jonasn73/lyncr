// ============================================
// GET /api/tech/jobs
// ============================================
// Jobs assigned to the signed-in field technician, their earned performance badges, and whether
// their owner can take card payments. Also opportunistically flushes any due scheduled texts.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getFieldTechnicianByPortalUserId,
  getOwnerMerchantConfigured,
  getTechJobMetrics,
  getUser,
  listJobsForTech,
  setTechEarnedBadges,
} from "@/lib/db"
import { computeTechBadges, earnedBadgeIds } from "@/lib/tech-badges"
import { flushDueScheduledSms } from "@/lib/sms-pipeline"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const tech = await getFieldTechnicianByPortalUserId(userId)
    const jobs = await listJobsForTech(userId)
    const merchantConfigured = tech ? await getOwnerMerchantConfigured(tech.owner_user_id) : false

    const metrics = await getTechJobMetrics(userId)
    const badges = computeTechBadges(metrics)

    // Persist the earned set + flush due review texts without blocking the response.
    after(async () => {
      try {
        await setTechEarnedBadges(userId, earnedBadgeIds(badges))
      } catch {
        /* deploy-safe: column may not exist yet */
      }
      try {
        await flushDueScheduledSms()
      } catch {
        /* best-effort */
      }
    })

    return NextResponse.json({ data: { jobs, merchant_configured: merchantConfigured, badges } })
  } catch (e) {
    console.error("[GET /api/tech/jobs] failed:", e)
    return NextResponse.json({ data: { jobs: [], merchant_configured: false, badges: [] }, degraded: true })
  }
}
