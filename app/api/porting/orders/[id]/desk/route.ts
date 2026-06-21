// GET /api/porting/orders/[id]/desk — owner porting drawer (pipeline + Telnyx conversation thread).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  countUnreadPortingNotificationsForOrder,
  getPortingOrderByIdForOwner,
  listPortingNotificationsChronological,
  markPortingNotificationsRead,
} from "@/lib/db"
import { buildPortingConversationFeed } from "@/lib/porting-conversation-feed"
import { buildOwnerPortingPipeline, getPortingBannerPhase } from "@/lib/porting-lifecycle"
import {
  orderPinSavedAwaitingCarrierReview,
  orderRequiresPinCorrection,
} from "@/lib/porting-pin-correction"
import {
  backfillPortingNotificationsFromTelnyxComments,
  backfillPortingExceptionsFromTelnyxOrder,
  syncPortingOrderFromTelnyxLive,
} from "@/lib/porting-telnyx-sync"
import { listTelnyxPortingOrderComments } from "@/lib/telnyx-porting-orders"
import type { OwnerPortingDeskDetail } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  let order = await getPortingOrderByIdForOwner(id, userId)
  if (!order) return NextResponse.json({ error: "Port order not found" }, { status: 404 })

  const telnyxOrderId = order.telnyx_order_id?.trim() || ""

  if (telnyxOrderId) {
    await backfillPortingExceptionsFromTelnyxOrder({
      ownerUserId: userId,
      telnyxOrderId,
      organizationId: order.organization_id,
    })
    await backfillPortingNotificationsFromTelnyxComments({
      ownerUserId: userId,
      telnyxOrderId,
    })
    order = await syncPortingOrderFromTelnyxLive(order)
  }

  const [notifications, telnyxComments, unreadCount] = await Promise.all([
    telnyxOrderId
      ? listPortingNotificationsChronological(userId, telnyxOrderId)
      : Promise.resolve([]),
    telnyxOrderId
      ? listTelnyxPortingOrderComments(telnyxOrderId).catch((e) => {
          console.warn("[porting/desk] Telnyx comments:", e)
          return []
        })
      : Promise.resolve([]),
    telnyxOrderId
      ? countUnreadPortingNotificationsForOrder(userId, telnyxOrderId)
      : Promise.resolve(0),
  ])

  const conversation = buildPortingConversationFeed(notifications, telnyxComments)
  const conversationSnippets = conversation.slice(-8).map((item) => item.body)
  const pin_saved_pending_review = orderPinSavedAwaitingCarrierReview(order, conversationSnippets)
  const pin_correction_required =
    orderRequiresPinCorrection(order, conversationSnippets) && !pin_saved_pending_review

  const detail: OwnerPortingDeskDetail = {
    order,
    notifications,
    conversation,
    pipeline_steps: buildOwnerPortingPipeline(order),
    unread_count: unreadCount,
    banner_phase: getPortingBannerPhase(order, unreadCount),
    pin_correction_required,
    pin_saved_pending_review,
  }

  if (req.nextUrl.searchParams.get("mark_read") === "1" && notifications.length > 0) {
    const unreadIds = notifications.filter((n) => n.read_at == null).map((n) => n.id)
    if (unreadIds.length > 0) await markPortingNotificationsRead(userId, unreadIds)
  }

  return NextResponse.json({ data: detail })
}
