// GET /api/admin/pending-shops-pulse — new signups waiting for Approve/Deny, for the admin header bell.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAdminPendingShopsPulse } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const pulse = await getAdminPendingShopsPulse()
    return NextResponse.json({ data: pulse })
  } catch (e) {
    console.error("[admin/pending-shops-pulse GET]", e)
    return NextResponse.json({ error: "Failed to load pending shops" }, { status: 500 })
  }
}
