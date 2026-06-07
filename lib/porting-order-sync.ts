// Sync `porting_orders` rows from Telnyx port-in webhooks (timeline + status).

import type { PortingOrderStatus } from "@/lib/types"
import {
  getPortingOrderByTelnyxOrderId,
  mapTelnyxStatusToPortingOrderStatus,
  updatePortingOrderByTelnyxOrderId,
} from "@/lib/db"
import {
  collectPortingStatuses,
  normalizeTelnyxPortStatus,
  pickBestPortingStatus,
  PORTING_STATUS_PRIORITY,
} from "@/lib/telnyx-porting-status"
import { extractPortingOrderRecord, findPortingOrderId } from "@/lib/telnyx-porting-webhook"

const STATUS_RANK: Record<PortingOrderStatus, number> = {
  pending: 0,
  processing: 1,
  completed: 2,
  rejected: 2,
}

/** Avoid downgrading a terminal row when Telnyx sends stale nested `draft`. */
export function shouldAdvancePortingOrderStatus(
  current: PortingOrderStatus,
  next: PortingOrderStatus
): boolean {
  if (current === next) return true
  if (current === "completed" && next !== "rejected") return false
  if (current === "rejected" && next !== "rejected") return false
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
