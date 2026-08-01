// GET /api/admin/business-economics — per-shop P&L (admin only).
// Optional ?user_id= for one business; omit for the full list.
// Optional ?period=this_month|last_month|last_30_days (default this_month).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  getAdminBusinessEconomics,
  listAdminBusinessEconomics,
  parseAdminMoneyPeriod,
} from "@/lib/admin-business-economics"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    // Read which time window the Ops UI asked for (This month / Last month / Last 30 days).
    const period = parseAdminMoneyPeriod(req.nextUrl.searchParams.get("period"))
    const userId = req.nextUrl.searchParams.get("user_id")?.trim()
    if (userId) {
      const row = await getAdminBusinessEconomics(userId, period)
      if (!row) {
        return NextResponse.json({ error: "Business not found" }, { status: 404 })
      }
      return NextResponse.json({ data: row })
    }
    const rows = await listAdminBusinessEconomics(period)
    return NextResponse.json({ data: { businesses: rows, period } })
  } catch (e) {
    console.error("[lyncr-admin] business-economics:", e)
    return NextResponse.json({ error: "Failed to load business economics" }, { status: 500 })
  }
}
