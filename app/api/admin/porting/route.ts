// GET /api/admin/porting?owner_user_id= — list porting orders for admin desk.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listPortingOrdersForOwner } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard

  const ownerUserId = new URL(req.url).searchParams.get("owner_user_id")?.trim()
  if (!ownerUserId) {
    return NextResponse.json({ error: "owner_user_id is required" }, { status: 400 })
  }

  try {
    const orders = await listPortingOrdersForOwner(ownerUserId)
    return NextResponse.json({ data: { orders } })
  } catch (e) {
    console.error("[admin/porting] GET list:", e)
    return NextResponse.json({ error: "Could not load porting orders" }, { status: 500 })
  }
}
