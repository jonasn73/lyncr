// Pull live Telnyx porting comments into our DB + refresh order status when webhooks were missed.

import {
  insertPortingNotificationIfNew,
  listPortingOrdersForOwner,
  mapTelnyxStatusToPortingOrderStatus,
  markPortingOrderActionRequired,
  patchPortingOrderFields,
  rejectPortingOrderWithReason,
} from "@/lib/db"
import type { PortingOrder } from "@/lib/types"
import {
  collectPortingStatuses,
  normalizeTelnyxPortStatus,
  pickBestPortingStatus,
} from "@/lib/telnyx-porting-status"
import { finalizePortedNumber } from "@/lib/port-number-finalize"
import {
  fetchTelnyxPortingOrderById,
  listTelnyxPortingOrderComments,
} from "@/lib/telnyx-porting-orders"
import {
  cleansePortingHumanComment,
  displayUserFacingMessage,
  formatPortingThreadMessage,
} from "@/lib/porting-display"
import { formatPortingSystemStatusMessage } from "@/lib/porting-notification-log"
import {
  carrierTextIndicatesFocConfirmed,
  telnyxLiveOrderIndicatesFocScheduled,
} from "@/lib/porting-foc-detection"
import { isActivePortingOrder } from "@/lib/porting-lifecycle"
import { shouldUpdateTelnyxStatus } from "@/lib/porting-order-sync"
import {
  extractPortingCarrierRequirement,
  extractPortingCarrierRequirementLogBody,
  extractLosingCarrierName,
  formatPortingExceptionSystemMessage,
} from "@/lib/porting-carrier-exceptions"
import {
  isPortRejectionWebhook,
  looksLikePinPasscodeRejection,
  looksLikeCarrierRejection,
} from "@/lib/telnyx-porting-webhook"

/** Backfill structured losing-carrier exception line from live Telnyx order payload. */
export async function backfillPortingExceptionsFromTelnyxOrder(params: {
  ownerUserId: string
  telnyxOrderId: string
  organizationId?: string | null
}): Promise<boolean> {
  const telnyxOrderId = params.telnyxOrderId.trim()
  if (!telnyxOrderId) return false
  const live = await fetchTelnyxPortingOrderById(telnyxOrderId)
  if (!live) return false

  const liveStatuses = collectPortingStatuses(live)
  if (liveStatuses.length > 0 && pickBestPortingStatus(liveStatuses) === "ported") {
    return false
  }

  const requirement = extractPortingCarrierRequirement({ data: { record: live } })
  const body = requirement
    ? formatPortingExceptionSystemMessage(requirement.exception_text)
    : extractPortingCarrierRequirementLogBody({ data: { record: live } })
  if (!body) return false

  return insertPortingNotificationIfNew({
    userId: params.ownerUserId,
    organizationId: params.organizationId,
    telnyxEventId: `telnyx-exception-sync-${telnyxOrderId}-${requirement?.exception_text?.slice(0, 40) ?? "generic"}`,
    portingOrderId: telnyxOrderId,
    eventType: "porting_order.status_changed",
    title: "Action needed on your transfer",
    body,
    rawPayload: live,
  })
}

/** Normalize carrier comment text for in-app alerts (keep substantive updates when PIN heuristics miss). */
function portingCommentNotificationBody(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  return (
    cleansePortingHumanComment(trimmed) ||
    formatPortingThreadMessage(trimmed) ||
    displayUserFacingMessage(trimmed).slice(0, 500)
  )
}

/** Skip only the business owner's outbound desk replies — everything else is carrier-side. */
function isCarrierPortingCommentUserType(userType: string): boolean {
  const ut = userType.toLowerCase().trim()
  return ut !== "user" && ut !== "customer" && ut !== "owner"
}

/** Backfill porting_notifications from Telnyx /comments (historical + missed webhooks). */
export async function backfillPortingNotificationsFromTelnyxComments(params: {
  ownerUserId: string
  telnyxOrderId: string
  organizationId?: string | null
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
    if (!isCarrierPortingCommentUserType(c.user_type)) continue
    const raw = c.body.trim()
    if (!raw) continue
    const body = portingCommentNotificationBody(raw)
    if (!body) continue
    const ok = await insertPortingNotificationIfNew({
      userId: params.ownerUserId,
      organizationId: params.organizationId,
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

/** Backfill a status-transition row when Telnyx webhooks never reached Lyncr. */
export async function backfillPortingStatusFromTelnyxLive(params: {
  ownerUserId: string
  telnyxOrderId: string
  organizationId?: string | null
}): Promise<boolean> {
  const telnyxOrderId = params.telnyxOrderId.trim()
  if (!telnyxOrderId) return false
  const live = await fetchTelnyxPortingOrderById(telnyxOrderId)
  if (!live) return false
  const statuses = collectPortingStatuses(live)
  if (statuses.length === 0) return false
  const keyword = pickBestPortingStatus(statuses)
  return insertPortingNotificationIfNew({
    userId: params.ownerUserId,
    organizationId: params.organizationId,
    telnyxEventId: `telnyx-status-sync-${telnyxOrderId}-${keyword}`,
    portingOrderId: telnyxOrderId,
    eventType: "porting_order.status_changed",
    title: "Transfer status updated",
    body: formatPortingSystemStatusMessage(keyword),
    rawPayload: live,
  })
}

/** Pull Telnyx comments + status into DB for one active port order. */
export async function syncPortingOrderNotificationsFromTelnyx(
  order: PortingOrder
): Promise<{ inserted: number; order: PortingOrder }> {
  const telnyxId = order.telnyx_order_id?.trim()
  if (!telnyxId) return { inserted: 0, order }

  let inserted = 0
  try {
    if (
      await backfillPortingExceptionsFromTelnyxOrder({
        ownerUserId: order.owner_user_id,
        telnyxOrderId: telnyxId,
        organizationId: order.organization_id,
      })
    ) {
      inserted += 1
    }
    inserted += await backfillPortingNotificationsFromTelnyxComments({
      ownerUserId: order.owner_user_id,
      telnyxOrderId: telnyxId,
      organizationId: order.organization_id,
    })
    if (
      await backfillPortingStatusFromTelnyxLive({
        ownerUserId: order.owner_user_id,
        telnyxOrderId: telnyxId,
        organizationId: order.organization_id,
      })
    ) {
      inserted += 1
    }
  } catch (e) {
    console.warn("[porting-telnyx-sync] notification sync:", e)
  }

  const syncedOrder = await syncPortingOrderFromTelnyxLive(order)
  return { inserted, order: syncedOrder }
}

/** Sync all in-flight port orders for an owner workspace (missed webhook recovery). */
export async function syncActivePortingOrdersForOwner(params: {
  ownerUserId: string
  organizationId: string | null
}): Promise<{ inserted: number; orders: PortingOrder[] }> {
  const orders = await listPortingOrdersForOwner(params.ownerUserId, params.organizationId)
  const active = orders.filter(isActivePortingOrder)
  let inserted = 0
  const synced: PortingOrder[] = []

  for (const order of active) {
    const result = await syncPortingOrderNotificationsFromTelnyx(order)
    inserted += result.inserted
    synced.push(result.order)
  }

  return { inserted, orders: synced }
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

  const carrierBodies = comments
    .filter((c) => isCarrierPortingCommentUserType(c.user_type))
    .map((c) => c.body.trim())
    .filter(Boolean)

  const focConfirmed =
    (live ? telnyxLiveOrderIndicatesFocScheduled(live) : false) ||
    carrierBodies.some((body) => carrierTextIndicatesFocConfirmed(body))

  let telnyxStatus = order.telnyx_status
  let liveMapped: ReturnType<typeof mapTelnyxStatusToPortingOrderStatus> | null = null
  if (live) {
    const statuses = collectPortingStatuses(live)
    if (statuses.length > 0) {
      telnyxStatus = pickBestPortingStatus(statuses)
      liveMapped = mapTelnyxStatusToPortingOrderStatus(telnyxStatus)
    }
  }

  const liveIsPorted =
    liveMapped === "completed" ||
    normalizeTelnyxPortStatus(telnyxStatus ?? "") === "ported"

  if (liveIsPorted && order.status !== "rejected") {
    const wasCompleted = order.status === "completed"
    const losingCarrier = live ? extractLosingCarrierName({ data: { record: live } }) : null
    const carrierPatch =
      losingCarrier &&
      (!order.current_carrier.trim() || order.current_carrier.trim().toLowerCase() === "your current carrier")
        ? losingCarrier
        : undefined
    const telnyxToWrite = shouldUpdateTelnyxStatus(order.telnyx_status, telnyxStatus ?? "ported")
      ? (telnyxStatus ?? "ported")
      : order.telnyx_status

    if (wasCompleted && order.status === "completed" && telnyxToWrite === order.telnyx_status && !carrierPatch) {
      return order
    }

    const patched = await patchPortingOrderFields(order.id, {
      status: "completed",
      telnyx_status: telnyxToWrite ?? order.telnyx_status,
      carrier_rejection_reason: null,
      ...(carrierPatch ? { current_carrier: carrierPatch } : {}),
    })
    const result = patched ?? order

    if (!wasCompleted) {
      await finalizePortedNumber({
        ownerUserId: order.owner_user_id,
        phoneNumberE164: result.phone_number ?? order.phone_number,
        telnyxOrderId,
        organizationId: order.organization_id,
      })
    }
    return result
  }

  let nextStatus = order.status
  let rejectionReason: string | null = null
  let actionNote: string | null = null

  if (focConfirmed && order.status !== "rejected" && order.status !== "completed") {
    nextStatus = "processing"
  } else if (live) {
    const requirement = extractPortingCarrierRequirement({ data: { record: live } })
    const liveRequirement = requirement
      ? formatPortingExceptionSystemMessage(requirement.exception_text)
      : extractPortingCarrierRequirementLogBody({ data: { record: live } })
    if (liveRequirement) {
      actionNote = requirement?.exception_text ?? liveRequirement
      if (order.status !== "rejected" && order.status !== "completed") {
        nextStatus = "action_required"
      }
    }
  }

  if (!focConfirmed && latestAdmin?.body.trim()) {
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
      rejectionReason = actionNote ?? body
    } else if (isPortRejectionWebhook(pseudoPayload)) {
      nextStatus = "rejected"
      rejectionReason = actionNote ?? body
    } else if (carrierTextIndicatesFocConfirmed(body)) {
      if (order.status !== "rejected" && order.status !== "completed") {
        nextStatus = "processing"
      }
    } else if (order.status !== "rejected" && order.status !== "completed") {
      nextStatus = "action_required"
      actionNote = actionNote ?? body
    }
  }

  if (live && liveMapped) {
    const mapped = liveMapped
    if (focConfirmed && order.status !== "rejected" && order.status !== "completed") {
      nextStatus = "processing"
      if (shouldUpdateTelnyxStatus(telnyxStatus, "foc-date-confirmed")) {
        telnyxStatus = "foc-date-confirmed"
      }
    } else if (mapped === "completed") {
      nextStatus = "completed"
    } else if (mapped === "rejected" && nextStatus !== "completed") {
      nextStatus = "rejected"
      rejectionReason =
        rejectionReason ??
        actionNote ??
        latestAdmin?.body?.trim() ??
        order.carrier_rejection_reason ??
        null
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
  } else if (
    focConfirmed &&
    shouldUpdateTelnyxStatus(order.telnyx_status, "foc-date-confirmed")
  ) {
    telnyxStatus = "foc-date-confirmed"
  }

  if (nextStatus === order.status && telnyxStatus === order.telnyx_status && !rejectionReason) {
    const noteToPersist = actionNote?.trim()
    const reasonEmpty = !(order.carrier_rejection_reason ?? "").trim()
    const needsReason =
      !focConfirmed &&
      reasonEmpty &&
      noteToPersist &&
      (nextStatus === "action_required" || telnyxStatus.toLowerCase().includes("exception"))
    if (needsReason) {
      const updated = await markPortingOrderActionRequired(
        order.owner_user_id,
        telnyxOrderId,
        noteToPersist
      )
      return updated ?? order
    }
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
      actionNote ?? latestAdmin?.body?.trim() ?? null
    )
    return updated ?? order
  }

  const losingCarrier = live ? extractLosingCarrierName({ data: { record: live } }) : null
  const carrierPatch =
    losingCarrier &&
    (!order.current_carrier.trim() || order.current_carrier.trim().toLowerCase() === "your current carrier")
      ? losingCarrier
      : undefined

  const wasCompleted = order.status === "completed"
  const patched = await patchPortingOrderFields(order.id, {
    status: nextStatus,
    telnyx_status: telnyxStatus ?? order.telnyx_status,
    ...(nextStatus === "completed" ? { carrier_rejection_reason: null } : {}),
    ...(carrierPatch ? { current_carrier: carrierPatch } : {}),
  })
  const result = patched ?? order

  if (!wasCompleted && nextStatus === "completed") {
    await finalizePortedNumber({
      ownerUserId: order.owner_user_id,
      phoneNumberE164: result.phone_number ?? order.phone_number,
      telnyxOrderId,
    })
  }

  return result
}
