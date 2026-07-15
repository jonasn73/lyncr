// ============================================
// GET /api/admin/overview
// ============================================
// Aggregate counts for the operator dashboard.

import { NextRequest, NextResponse } from "next/server"
import { getAdminDashboardStats } from "@/lib/db"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"
import { formatUsdFromCents } from "@/lib/billing-pricing"

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const stats = await getAdminDashboardStats()
    return NextResponse.json({
      data: {
        ...stats,
        total_credit_balance_label: formatUsdFromCents(stats.total_credit_balance_cents),
      },
    })
  } catch (e) {
    console.error("[lyncr] admin overview:", e)
    return NextResponse.json({ error: "Failed to load admin stats" }, { status: 500 })
  }
}
