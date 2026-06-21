// GET /api/admin/porting?owner_user_id= — list porting orders for admin desk.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listPortingOrdersForOwner } from "@/lib/db"
import { syncPortingOrderFromTelnyxLive } from "@/lib/porting-telnyx-sync"

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
    const synced = await Promise.all(
      orders.map(async (order) => {
        if (order.status === "completed" || !order.telnyx_order_id?.trim()) return order
        try {
          return await syncPortingOrderFromTelnyxLive(order)
        } catch (e) {
          console.warn("[admin/porting] live sync skipped for", order.id, e)
          return order
        }
      })
    )
    return NextResponse.json({ data: { orders: synced } })
  } catch (e) {
    console.error("[admin/porting] GET list:", e)
    return NextResponse.json({ error: "Could not load porting orders" }, { status: 500 })
  }
}
