// GET /api/admin/business-economics — per-shop P&L (admin only).
// Optional ?user_id= for one business; omit for the full list.
// Optional ?period=all_time|this_month|last_month|this_year (default all_time).

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
    // Read which time window the Ops UI asked for (All time / This month / Last month / This year).
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
