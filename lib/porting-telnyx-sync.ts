// Pull live Telnyx porting comments into our DB + refresh order status when webhooks were missed.

import {
  insertPortingNotificationIfNew,
  mapTelnyxStatusToPortingOrderStatus,
  markPortingOrderActionRequired,
  patchPortingOrderFields,
  rejectPortingOrderWithReason,
} from "@/lib/db"
import type { PortingOrder } from "@/lib/types"
import {
  collectPortingStatuses,
  pickBestPortingStatus,
} from "@/lib/telnyx-porting-status"
import {
  fetchTelnyxPortingOrderById,
  listTelnyxPortingOrderComments,
} from "@/lib/telnyx-porting-orders"
import { cleansePortingHumanComment } from "@/lib/porting-display"
import {
  isPortRejectionWebhook,
  looksLikePinPasscodeRejection,
  looksLikeCarrierRejection,
} from "@/lib/telnyx-porting-webhook"

/** Backfill porting_notifications from Telnyx /comments (historical + missed webhooks). */
export async function backfillPortingNotificationsFromTelnyxComments(params: {
  ownerUserId: string
  telnyxOrderId: string
}): Promise<number> {
  const telnyxOrderId = params.telnyxOrderId.trim()
  if (!telnyxOrderId) return 0

  let comments: Awaited<ReturnType<typeof listTelnyxPortingOrderComments>>
  try {
    comments = await listTelnyxPortingOrderComments(telnyxOrderId)
  } catch (e) {
    console.warn("[porting-telnyx-sync] comments fetch failed:", e)
    return 0
  }

  let inserted = 0
  for (const c of comments) {
    const ut = c.user_type.toLowerCase()
    if (ut !== "admin" && ut !== "system") continue
    const raw = c.body.trim()
    if (!raw) continue
    const body = cleansePortingHumanComment(raw) || raw
    const ok = await insertPortingNotificationIfNew({
      userId: params.ownerUserId,
      telnyxEventId: `telnyx-comment-sync-${c.id}`,
      portingOrderId: telnyxOrderId,
      eventType: "porting_order.comment_created",
      title: "New comment on your transfer",
      body,
      rawPayload: c,
    })
    if (ok) inserted += 1
  }
  return inserted
}

/** Align porting_orders row with live Telnyx status + latest admin comment when webhooks lag. */
export async function syncPortingOrderFromTelnyxLive(order: PortingOrder): Promise<PortingOrder> {
  const telnyxOrderId = order.telnyx_order_id?.trim()
  if (!telnyxOrderId) return order

  const [live, comments] = await Promise.all([
    fetchTelnyxPortingOrderById(telnyxOrderId),
    listTelnyxPortingOrderComments(telnyxOrderId).catch(() => []),
  ])

  const adminComments = comments
    .filter((c) => c.user_type.toLowerCase() === "admin" || c.user_type.toLowerCase() === "system")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const latestAdmin = adminComments[0]

  let nextStatus = order.status
  let rejectionReason: string | null = null

  if (latestAdmin?.body.trim()) {
    const raw = latestAdmin.body.trim()
    const body = cleansePortingHumanComment(raw) || raw
    const pseudoPayload = {
      event_type: "porting_order.comment_created",
      data: { record: { body, user_type: latestAdmin.user_type } },
    } as Record<string, unknown>

    if (
      looksLikePinPasscodeRejection(body) ||
      (looksLikeCarrierRejection(body) &&
        (body.toLowerCase().includes("reject") || body.toLowerCase().includes("rejection")))
    ) {
      nextStatus = "rejected"
      rejectionReason = body
    } else if (isPortRejectionWebhook(pseudoPayload)) {
      nextStatus = "rejected"
      rejectionReason = body
    } else if (order.status !== "rejected" && order.status !== "completed") {
      nextStatus = "action_required"
    }
  }

  let telnyxStatus = order.telnyx_status
  if (live) {
    const statuses = collectPortingStatuses(live)
    if (statuses.length > 0) {
      telnyxStatus = pickBestPortingStatus(statuses)
      const mapped = mapTelnyxStatusToPortingOrderStatus(telnyxStatus)
      if (mapped === "rejected" && nextStatus !== "completed") {
        nextStatus = "rejected"
        rejectionReason =
          rejectionReason ?? latestAdmin?.body?.trim() ?? order.carrier_rejection_reason ?? null
      } else if (mapped === "action_required" && nextStatus !== "rejected") {
        nextStatus = "action_required"
      } else if (
        nextStatus !== "rejected" &&
        nextStatus !== "action_required" &&
        mapped !== order.status
      ) {
        if (mapped === "processing" || mapped === "submitted" || mapped === "pending_carrier_review") {
          nextStatus = mapped
        }
      }
    }
  }

  if (nextStatus === order.status && telnyxStatus === order.telnyx_status && !rejectionReason) {
    return order
  }

  if (nextStatus === "rejected" && rejectionReason) {
    const updated = await rejectPortingOrderWithReason(order.owner_user_id, telnyxOrderId, rejectionReason)
    return updated ?? order
  }

  if (nextStatus === "action_required" && order.status !== "rejected") {
    const updated = await markPortingOrderActionRequired(
      order.owner_user_id,
      telnyxOrderId,
      latestAdmin?.body?.trim() ?? null
    )
    return updated ?? order
  }

  const patched = await patchPortingOrderFields(order.id, {
    status: nextStatus,
    telnyx_status: telnyxStatus ?? order.telnyx_status,
  })
  return patched ?? order
}
