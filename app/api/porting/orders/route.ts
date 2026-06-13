// GET /api/porting/orders — list native LNP port orders for the signed-in owner (optional org filter).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, listPortingOrdersForOwner, countUnreadPortingNotificationsForOrder } from "@/lib/db"
import { isActivePortingOrder } from "@/lib/porting-lifecycle"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "owner") {
    return NextResponse.json({ error: "Only business owners can view port orders" }, { status: 403 })
  }

  const orgId = req.nextUrl.searchParams.get("organization_id")?.trim() || null

  try {
    const orders = await listPortingOrdersForOwner(userId, orgId)
    const activeOnly = req.nextUrl.searchParams.get("active") === "1"
    const filtered = activeOnly ? orders.filter(isActivePortingOrder) : orders
    const enriched = await Promise.all(
      filtered.map(async (order) => {
        const telnyxId = order.telnyx_order_id?.trim() || ""
        const unread_notification_count = telnyxId
          ? await countUnreadPortingNotificationsForOrder(userId, telnyxId)
          : 0
        return { ...order, unread_notification_count }
      })
    )
    return NextResponse.json({ data: { orders: enriched } })
  } catch (e) {
    console.error("[GET /api/porting/orders] failed:", e)
    return NextResponse.json({ error: "Could not load port orders" }, { status: 500 })
  }
}
