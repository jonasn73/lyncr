// GET /api/porting/orders/[id]/desk — owner porting drawer (pipeline + notification thread).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  countUnreadPortingNotificationsForOrder,
  getPortingOrderByIdForOwner,
  listPortingNotificationsChronological,
  markPortingNotificationsRead,
} from "@/lib/db"
import { buildOwnerPortingPipeline, getPortingBannerPhase } from "@/lib/porting-lifecycle"
import type { OwnerPortingDeskDetail } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const order = await getPortingOrderByIdForOwner(id, userId)
  if (!order) return NextResponse.json({ error: "Port order not found" }, { status: 404 })

  const telnyxOrderId = order.telnyx_order_id?.trim() || ""
  const [notifications, unreadCount] = await Promise.all([
    telnyxOrderId
      ? listPortingNotificationsChronological(userId, telnyxOrderId)
      : Promise.resolve([]),
    telnyxOrderId
      ? countUnreadPortingNotificationsForOrder(userId, telnyxOrderId)
      : Promise.resolve(0),
  ])

  const detail: OwnerPortingDeskDetail = {
    order,
    notifications,
    pipeline_steps: buildOwnerPortingPipeline(order),
    unread_count: unreadCount,
    banner_phase: getPortingBannerPhase(order, unreadCount),
  }

  if (req.nextUrl.searchParams.get("mark_read") === "1" && notifications.length > 0) {
    const unreadIds = notifications.filter((n) => n.read_at == null).map((n) => n.id)
    if (unreadIds.length > 0) await markPortingNotificationsRead(userId, unreadIds)
  }

  return NextResponse.json({ data: detail })
}
