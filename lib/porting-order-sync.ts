// Sync `porting_orders` rows from Telnyx port-in webhooks (timeline + status).

import type { PortingOrderStatus } from "@/lib/types"
import {
  getPortingOrderByTelnyxOrderId,
  mapTelnyxStatusToPortingOrderStatus,
  markPortingOrderActionRequired,
  rejectPortingOrderWithReason,
  updatePortingOrderByTelnyxOrderId,
} from "@/lib/db"
import {
  collectPortingStatuses,
  normalizeTelnyxPortStatus,
  pickBestPortingStatus,
  PORTING_STATUS_PRIORITY,
} from "@/lib/telnyx-porting-status"
import { cleansePortingHumanComment } from "@/lib/porting-display"
import { buildPortingNotificationLogBody } from "@/lib/porting-notification-log"
import {
  extractEventType,
  extractPortRejectionReason,
  extractPortingOrderRecord,
  findPortingOrderId,
  isPortRejectionWebhook,
  looksLikePinPasscodeRejection,
  buildPortingNotificationText,
} from "@/lib/telnyx-porting-webhook"

function cleansedPortingWebhookText(body: Record<string, unknown>, eventType?: string): string {
  const logged = buildPortingNotificationLogBody(body, eventType).trim()
  if (logged && !logged.startsWith("System Update:")) return logged
  const raw = buildPortingNotificationText(body).trim()
  return cleansePortingHumanComment(raw) || raw
}

const STATUS_RANK: Record<PortingOrderStatus, number> = {
  pending: 0,
  submitted: 0,
  pending_carrier_review: 1,
  processing: 1,
  pending_info: 2,
  action_required: 2,
  rejected: 3,
  completed: 4,
}

/** Avoid downgrading a terminal row when Telnyx sends stale nested `draft`. */
export function shouldAdvancePortingOrderStatus(
  current: PortingOrderStatus,
  next: PortingOrderStatus
): boolean {
  if (current === next) return true
  if (current === "completed" && next !== "rejected") return false
  if (current === "rejected" && next !== "rejected") return false
  if (current === "rejected") return next === "rejected"
  if (
    current === "action_required" &&
    (next === "processing" ||
      next === "pending_carrier_review" ||
      next === "submitted" ||
      next === "pending" ||
      next === "completed")
  ) {
    return true
  }
  return STATUS_RANK[next] >= STATUS_RANK[current]
}

/** Keep the furthest-along Telnyx status string (avoids stale `draft` over `ported`). */
export function shouldUpdateTelnyxStatus(current: string | null | undefined, next: string): boolean {
  if (!current?.trim()) return true
  const curPri = PORTING_STATUS_PRIORITY[normalizeTelnyxPortStatus(current)] ?? 0
  const nextPri = PORTING_STATUS_PRIORITY[normalizeTelnyxPortStatus(next)] ?? 0
  return nextPri >= curPri
}

export type SyncPortingOrderResult = {
  updated: boolean
  telnyx_order_id: string | null
  telnyx_status: string | null
  status: PortingOrderStatus | null
  /** True when this webhook just moved the order to completed (Live on Lyncr). */
  just_completed?: boolean
  phone_number?: string | null
  skipped_reason?: string
}

export type ApplyPortActionRequiredResult = {
  applied: boolean
  telnyx_order_id: string | null
  skipped_reason?: string
}

/**
 * On carrier-agent comments / exceptions, set status `action_required` before rejection.
 */
export async function applyPortActionRequiredFromTelnyxWebhook(params: {
  ownerUserId: string
  body: Record<string, unknown>
  telnyxOrderId?: string | null
}): Promise<ApplyPortActionRequiredResult> {
  if (!isPortActionRequiredWebhook(params.body)) {
    return { applied: false, telnyx_order_id: null, skipped_reason: "not_action_required" }
  }

  const telnyxOrderId = params.telnyxOrderId?.trim() || findPortingOrderId(params.body)
  if (!telnyxOrderId) {
    return { applied: false, telnyx_order_id: null, skipped_reason: "no_order_id" }
  }

  const eventType = extractEventType(params.body)
  const note =
    extractPortRejectionReason(params.body, eventType) ||
    cleansedPortingWebhookText(params.body, eventType) ||
    null

  const updated = await markPortingOrderActionRequired(params.ownerUserId, telnyxOrderId, note)
  if (!updated) {
    return { applied: false, telnyx_order_id: telnyxOrderId, skipped_reason: "no_porting_orders_row" }
  }

  return { applied: true, telnyx_order_id: telnyxOrderId }
}

export type ApplyPortRejectionResult = {
  applied: boolean
  telnyx_order_id: string | null
  carrier_rejection_reason: string | null
  skipped_reason?: string
}

/**
 * On `porting_order.comment_created` / `porting_order.rejected`, persist rejection text
 * and set status to `rejected` on the matching porting_orders row.
 */
export async function applyPortRejectionFromTelnyxWebhook(params: {
  ownerUserId: string
  body: Record<string, unknown>
  telnyxOrderId?: string | null
}): Promise<ApplyPortRejectionResult> {
  if (!isPortRejectionWebhook(params.body)) {
    return { applied: false, telnyx_order_id: null, carrier_rejection_reason: null, skipped_reason: "not_rejection" }
  }

  const telnyxOrderId = params.telnyxOrderId?.trim() || findPortingOrderId(params.body)
  if (!telnyxOrderId) {
    return { applied: false, telnyx_order_id: null, carrier_rejection_reason: null, skipped_reason: "no_order_id" }
  }

  const eventType = extractEventType(params.body)
  const commentText = cleansedPortingWebhookText(params.body, eventType)
  const reason =
    extractPortRejectionReason(params.body, eventType) ||
    (commentText && looksLikePinPasscodeRejection(commentText) ? commentText : null)
  if (!reason) {
    return {
      applied: false,
      telnyx_order_id: telnyxOrderId,
      carrier_rejection_reason: null,
      skipped_reason: "no_rejection_text",
    }
  }

  const updated = await rejectPortingOrderWithReason(params.ownerUserId, telnyxOrderId, reason)
  if (!updated) {
    return {
      applied: false,
      telnyx_order_id: telnyxOrderId,
      carrier_rejection_reason: reason,
      skipped_reason: "no_porting_orders_row",
    }
  }

  return { applied: true, telnyx_order_id: telnyxOrderId, carrier_rejection_reason: reason }
}

/**
 * Map webhook payload → best Telnyx status → update matching `porting_orders` row.
 */
export async function syncPortingOrderFromTelnyxWebhook(params: {
  ownerUserId: string
  body: Record<string, unknown>
  telnyxOrderId?: string | null
}): Promise<SyncPortingOrderResult> {
  const telnyxOrderId = params.telnyxOrderId?.trim() || findPortingOrderId(params.body)
  if (!telnyxOrderId) {
    return { updated: false, telnyx_order_id: null, telnyx_status: null, status: null, skipped_reason: "no_order_id" }
  }

  const record = extractPortingOrderRecord(params.body)
  const statuses = record ? collectPortingStatuses(record) : []
  if (statuses.length === 0) {
    return {
      updated: false,
      telnyx_order_id: telnyxOrderId,
      telnyx_status: null,
      status: null,
      skipped_reason: "no_status_in_payload",
    }
  }

  const telnyxStatus = pickBestPortingStatus(statuses)
  const nextStatus = mapTelnyxStatusToPortingOrderStatus(telnyxStatus)

  const existing = await getPortingOrderByTelnyxOrderId(params.ownerUserId, telnyxOrderId)
  if (!existing) {
    return {
      updated: false,
      telnyx_order_id: telnyxOrderId,
      telnyx_status: telnyxStatus,
      status: nextStatus,
      skipped_reason: "no_porting_orders_row",
    }
  }

  const statusToWrite = shouldAdvancePortingOrderStatus(existing.status, nextStatus)
    ? nextStatus
    : existing.status
  const telnyxToWrite = shouldUpdateTelnyxStatus(existing.telnyx_status, telnyxStatus)
    ? telnyxStatus
    : (existing.telnyx_status ?? telnyxStatus)

  const wasCompleted = existing.status === "completed"

  if (statusToWrite === existing.status && telnyxToWrite === existing.telnyx_status) {
    return {
      updated: false,
      telnyx_order_id: telnyxOrderId,
      telnyx_status: telnyxToWrite,
      status: statusToWrite,
      just_completed: false,
      phone_number: existing.phone_number,
      skipped_reason: "no_change",
    }
  }

  if (statusToWrite === "rejected") {
    const reason =
      extractPortRejectionReason(params.body) ||
      existing.carrier_rejection_reason ||
      "Port request rejected by carrier."
    const updated = await rejectPortingOrderWithReason(params.ownerUserId, telnyxOrderId, reason)
    return {
      updated: updated != null,
      telnyx_order_id: telnyxOrderId,
      telnyx_status: telnyxToWrite,
      status: "rejected" as PortingOrderStatus,
      just_completed: false,
      phone_number: updated?.phone_number ?? existing.phone_number,
    }
  }

  if (statusToWrite === "action_required" && existing.status !== "rejected") {
    const note = cleansedPortingWebhookText(params.body) || null
    const updated = await markPortingOrderActionRequired(params.ownerUserId, telnyxOrderId, note)
    if (updated) {
      return {
        updated: true,
        telnyx_order_id: telnyxOrderId,
        telnyx_status: telnyxToWrite,
        status: "action_required",
        just_completed: false,
        phone_number: updated.phone_number,
      }
    }
  }

  const updated = await updatePortingOrderByTelnyxOrderId(params.ownerUserId, telnyxOrderId, {
    status: statusToWrite,
    telnyx_status: telnyxToWrite,
  })

  const justCompleted = !wasCompleted && statusToWrite === "completed"

  return {
    updated: updated != null,
    telnyx_order_id: telnyxOrderId,
    telnyx_status: telnyxStatus,
    status: statusToWrite,
    just_completed: justCompleted,
    phone_number: updated?.phone_number ?? existing.phone_number,
  }
}
