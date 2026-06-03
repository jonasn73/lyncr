// ============================================
// GET /api/tech/jobs
// ============================================
// Jobs assigned to the signed-in field technician (and whether their owner can take card payments).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getFieldTechnicianByPortalUserId,
  getOwnerMerchantConfigured,
  getUser,
  listJobsForTech,
} from "@/lib/db"

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
    return NextResponse.json({ data: { jobs, merchant_configured: merchantConfigured } })
  } catch (e) {
    console.error("[GET /api/tech/jobs] failed:", e)
    return NextResponse.json({ data: { jobs: [], merchant_configured: false }, degraded: true })
  }
}
