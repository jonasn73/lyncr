// ============================================
// GET /api/tech/jobs
// ============================================
// Jobs assigned to the signed-in field technician, their earned performance badges, and whether
// their owner can take card payments. Also opportunistically flushes any due scheduled texts.

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { resolveActor } from "@/lib/actor"
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
  const actor = await resolveActor(req.headers.get("cookie"), { allowFieldTech: true })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId

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
