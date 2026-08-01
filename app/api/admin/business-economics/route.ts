// GET /api/admin/business-economics — per-shop P&L (admin only).
// Optional ?user_id= for one business; omit for the full list.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  getAdminBusinessEconomics,
  listAdminBusinessEconomics,
} from "@/lib/admin-business-economics"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const userId = req.nextUrl.searchParams.get("user_id")?.trim()
    if (userId) {
      const row = await getAdminBusinessEconomics(userId)
      if (!row) {
        return NextResponse.json({ error: "Business not found" }, { status: 404 })
      }
      return NextResponse.json({ data: row })
    }
    const rows = await listAdminBusinessEconomics()
    return NextResponse.json({ data: { businesses: rows } })
  } catch (e) {
    console.error("[lyncr-admin] business-economics:", e)
    return NextResponse.json({ error: "Failed to load business economics" }, { status: 500 })
  }
}
