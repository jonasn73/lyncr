// GET /api/admin/industries/overview — per-industry coverage matrix (admin only).
// Live account counts from the DB, everything else computed in-process from the
// existing industry registries (business-industries / ai-intake-field-registry /
// job-intake-registry / customer-equipment-registry / business-type).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAdminIndustryAccountCounts } from "@/lib/db"
import { buildAdminIndustryOverview } from "@/lib/admin-industries-overview"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const accountCounts = await getAdminIndustryAccountCounts()
    const industries = buildAdminIndustryOverview(accountCounts)
    return NextResponse.json({ data: { industries } })
  } catch (e) {
    console.error("[lyncr-admin] industries-overview:", e)
    return NextResponse.json({ error: "Failed to load industry overview" }, { status: 500 })
  }
}
