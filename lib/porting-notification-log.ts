// Build sanitized porting_notifications body text from Telnyx webhook payloads.

import { cleansePortingHumanComment } from "@/lib/porting-display"
import {
  collectPortingStatuses,
  pickBestPortingStatus,
} from "@/lib/telnyx-porting-status"
import {
  buildPortingNotificationText,
  extractEventType,
  extractPortingOrderRecord,
} from "@/lib/telnyx-porting-webhook"

/** Status transition webhooks — not human desk comments. */
export function isPortingStatusChangedEvent(eventType: string): boolean {
  const lower = eventType.toLowerCase()
  return (
    lower.includes("status_changed") ||
    lower.includes("status.updated") ||
    (lower.includes("porting_order") && lower.includes("status") && !lower.includes("comment"))
  )
}

/** Raw comment body only (never full JSON / order metadata). */
export function extractRawPortingCommentBody(body: Record<string, unknown>): string | null {
  const data = body.data as Record<string, unknown> | undefined
  const record = data?.record as Record<string, unknown> | undefined
  if (typeof record?.body === "string" && record.body.trim()) {
    return record.body.trim()
  }
  const text = buildPortingNotificationText(body).trim()
  if (!text || text.startsWith("{") || text.startsWith("Order ")) return null
  return text
}

/** Best status keyword from a porting_order payload (exception, submitted, foc-date-confirmed, …). */
export function extractPortingStatusKeyword(body: Record<string, unknown>): string | null {
  const record = extractPortingOrderRecord(body)
  const statuses = record ? collectPortingStatuses(record) : []
  if (statuses.length > 0) return pickBestPortingStatus(statuses)

  const data = body.data as Record<string, unknown> | undefined
  const nested = data?.record as Record<string, unknown> | undefined
  const direct =
    (typeof nested?.porting_order_status === "string" && nested.porting_order_status) ||
    (typeof nested?.status === "string" && nested.status) ||
    (typeof data?.status === "string" && data.status) ||
    null
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim().toLowerCase().replace(/_/g, "-")
  }
  return null
}

/** Single-sentence system log for status transitions. */
export function formatPortingSystemStatusMessage(statusKeyword: string): string {
  const label = statusKeyword.toLowerCase().trim().replace(/_/g, "-")
  return `System Update: Transfer status changed to ${label}.`
}

/**
 * Notification body to persist — status events as micro-pill text; comments cleansed.
 */
export function buildPortingNotificationLogBody(
  body: Record<string, unknown>,
  eventType?: string
): string {
  const et = (eventType ?? extractEventType(body)).toLowerCase()

  if (isPortingStatusChangedEvent(et)) {
    const keyword = extractPortingStatusKeyword(body)
    return keyword ? formatPortingSystemStatusMessage(keyword) : "System Update: Transfer status changed."
  }

  if (et.includes("comment_created") || et.includes("comment")) {
    const raw = extractRawPortingCommentBody(body)
    if (raw) {
      const cleansed = cleansePortingHumanComment(raw)
      if (cleansed) return cleansed
    }
    const fallback = buildPortingNotificationText(body)
    const cleansed = cleansePortingHumanComment(fallback)
    return cleansed || fallback.slice(0, 2000)
  }

  if (!et.includes("comment")) {
    const keyword = extractPortingStatusKeyword(body)
    if (keyword) return formatPortingSystemStatusMessage(keyword)
  }

  const fallback = buildPortingNotificationText(body)
  if (et.includes("comment")) {
    return cleansePortingHumanComment(fallback) || fallback.slice(0, 2000)
  }
  return fallback
}

export function isPortingSystemNotificationBody(text: string, eventType: string): boolean {
  if (text.trim().startsWith("System Update:")) return true
  return isPortingStatusChangedEvent(eventType)
}
