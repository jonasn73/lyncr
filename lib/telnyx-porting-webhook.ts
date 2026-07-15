// ============================================
// Telnyx porting webhook — parse payloads into Lyncr rows
// ============================================
// Telnyx sends several JSON shapes (event_type at root vs meta, nested porting_order, etc.).
// We walk the tree for `customer_reference` starting with `lyncr-` or legacy `zing-`.

import { cleansePortingHumanComment } from "@/lib/porting-display"
import {
  extractPortingCarrierRequirementLogBody,
  hasPortingCarrierExceptions,
} from "@/lib/porting-carrier-exceptions"
import {
  findZingCustomerReferenceInPayload,
  parseZingCustomerReference,
} from "@/lib/telnyx-customer-reference"
import { collectPortingStatuses, pickBestPortingStatus } from "@/lib/telnyx-porting-status"

/** Telnyx porting webhook event types we handle in Lyncr. */
export const TELNYX_PORTING_WEBHOOK_EVENTS = new Set([
  "porting_order.status_changed",
  "porting_order.comment_created",
  "sub_request.exception",
])

/** True for port-in lifecycle webhooks (not SMS/voice). */
export function isTelnyxPortingWebhookEvent(eventType: string): boolean {
  const lower = eventType.toLowerCase().trim()
  if (TELNYX_PORTING_WEBHOOK_EVENTS.has(lower)) return true
  return lower.startsWith("porting_order.") || lower.includes("sub_request")
}

/** Find `customer_reference` like `lyncr-<uuid>` (or legacy `zing-<uuid>`) anywhere in the payload. */
export function findZingCustomerReference(obj: unknown): string | null {
  return findZingCustomerReferenceInPayload(obj)
}

export function customerRefToUserId(ref: string): string | null {
  return parseZingCustomerReference(ref)?.userId ?? null
}

/** Best-effort porting order id from nested objects. */
export function findPortingOrderId(obj: unknown): string | null {
  if (obj == null) return null
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>
    const direct = o.id ?? o.porting_order_id
    if (typeof direct === "string" && direct.length > 4) return direct
    const po = o.porting_order
    if (po && typeof po === "object") {
      const id = (po as Record<string, unknown>).id
      if (typeof id === "string") return id
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findPortingOrderId(item)
      if (r) return r
    }
  }
  if (typeof obj === "object" && obj !== null) {
    for (const k of Object.keys(obj as object)) {
      const r = findPortingOrderId((obj as Record<string, unknown>)[k])
      if (r) return r
    }
  }
  return null
}

/** Stable idempotency key for ON CONFLICT — never empty. */
export function extractTelnyxEventId(body: Record<string, unknown>): string {
  const meta = body.meta as Record<string, unknown> | undefined
  const data = body.data as Record<string, unknown> | undefined
  const candidates = [
    meta?.id,
    meta?.event_id,
    data?.id,
    body.id,
    body.event_id,
    body["event-id"],
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 4) return c
  }
  // Fallback: hash-like from event_type + order id + timestamp (still unique enough for retries)
  const et = extractEventType(body)
  const oid = findPortingOrderId(body) || ""
  const ts = typeof meta?.occurred_at === "string" ? meta.occurred_at : ""
  const fallback = `zing-fallback-${et}-${oid}-${ts}`
  return fallback.length > 12 ? fallback.slice(0, 200) : `zing-fallback-${Date.now()}`
}

export function extractEventType(body: Record<string, unknown>): string {
  const meta = body.meta as Record<string, unknown> | undefined
  const data = body.data as Record<string, unknown> | undefined
  const t =
    (typeof body.event_type === "string" && body.event_type) ||
    (typeof body.type === "string" && body.type) ||
    (meta && typeof meta.event_type === "string" && meta.event_type) ||
    (data && typeof data.event_type === "string" && data.event_type) ||
    "porting_order.unknown"
  return t
}

function humanizeEventType(eventType: string): string {
  const lower = eventType.toLowerCase()
  if (lower.includes("comment")) return "New comment on your transfer"
  if (lower.includes("status")) return "Transfer status updated"
  if (lower.includes("exception") || lower.includes("action")) return "Action needed on your transfer"
  if (lower.includes("complete") || lower.includes("ported")) return "Transfer progress"
  const tail = eventType.split(/[./]/).filter(Boolean).pop() || eventType
  const words = tail.replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Find Telnyx porting comment body in webhook JSON (nested shapes vary by event). */
function deepFindPortingCommentBody(obj: unknown, depth = 0): string | null {
  if (depth > 12 || obj == null) return null
  if (typeof obj === "string" && obj.length > 4000) return null
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>
    const rt = o.record_type
    const ut = o.user_type
    const b = o.body
    if (
      typeof b === "string" &&
      b.trim().length > 0 &&
      (rt === "porting_comment" || ut === "admin" || ut === "user" || ut === "system")
    ) {
      return b.trim()
    }
    for (const v of Object.values(o)) {
      const found = deepFindPortingCommentBody(v, depth + 1)
      if (found) return found
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindPortingCommentBody(item, depth + 1)
      if (found) return found
    }
  }
  return null
}

/** Short description for notification body. */
export function buildPortingNotificationText(body: Record<string, unknown>): string {
  try {
    const data = body.data as Record<string, unknown> | undefined
    const record = data?.record as Record<string, unknown> | undefined
    if (typeof record?.body === "string" && record.body.trim()) {
      return record.body.trim().slice(0, 2000)
    }
    const commentBody = deepFindPortingCommentBody(body)
    if (commentBody) return commentBody.slice(0, 2000)
    const po = findPortingOrderId(body)
    const extra =
      (typeof body.message === "string" && body.message) ||
      (typeof (body.data as Record<string, unknown> | undefined)?.message === "string" &&
        (body.data as Record<string, unknown>).message) ||
      ""
    const parts: string[] = []
    if (po) parts.push(`Order ${po}`)
    if (extra) parts.push(extra)
    if (parts.length > 0) return parts.join(" — ").slice(0, 2000)
    return JSON.stringify(body).slice(0, 1500)
  } catch {
    return "Porting update received."
  }
}

export function buildPortingNotificationTitle(eventType: string): string {
  return humanizeEventType(eventType)
}

/** Telnyx events that can mark a port order rejected. */
export function isPortRejectionEventType(eventType: string): boolean {
  const lower = eventType.toLowerCase()
  return lower.includes("porting_order.rejected") || lower.endsWith(".rejected")
}

/** True when text mentions PIN / passcode correction (Telnyx exceptions + desk comments). */
export function looksLikePinPasscodeRejection(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes("invalid pin") ||
    lower.includes("invalid passcode") ||
    lower.includes("passcode") ||
    lower.includes("pin/passcode") ||
    lower.includes("account pin") ||
    lower.includes("pin or passcode") ||
    lower.includes("pin/pass code") ||
    lower.includes("transfer pin") ||
    lower.includes("porting transfer pin") ||
    lower.includes("pin must be provided") ||
    lower.includes("wireless port")
  )
}

/** Comment / exception bodies that indicate the carrier rejected or needs correction. */
export function looksLikeCarrierRejection(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    looksLikePinPasscodeRejection(text) ||
    lower.includes("reject") ||
    lower.includes("action required") ||
    lower.includes("action item") ||
    lower.includes("exception") ||
    lower.includes("cannot be ported") ||
    lower.includes("port request failed")
  )
}

/** Best rejection / correction message from a Telnyx porting webhook payload. */
export function extractPortRejectionReason(body: Record<string, unknown>, eventType?: string): string | null {
  const carrierRequirement = extractPortingCarrierRequirementLogBody(body)
  if (carrierRequirement) return carrierRequirement

  const et = (eventType ?? extractEventType(body)).toLowerCase()
  const rawComment = buildPortingNotificationText(body).trim()
  const comment = rawComment ? cleansePortingHumanComment(rawComment) || rawComment : ""
  if (isPortRejectionEventType(et)) {
    return comment || "Port request rejected by carrier."
  }
  if (et.includes("comment") && comment && looksLikeCarrierRejection(comment)) {
    return comment
  }
  const data = body.data as Record<string, unknown> | undefined
  const record = data?.record as Record<string, unknown> | undefined
  const statusMsg =
    (typeof record?.status_message === "string" && record.status_message.trim()) ||
    (typeof record?.rejection_reason === "string" && record.rejection_reason.trim()) ||
    (typeof body.message === "string" && body.message.trim()) ||
    null
  if (statusMsg && looksLikeCarrierRejection(statusMsg)) {
    return cleansePortingHumanComment(statusMsg) || statusMsg
  }
  return null
}

/** True when this webhook should set porting_orders.status = rejected. */
export function isPortRejectionWebhook(body: Record<string, unknown>): boolean {
  const eventType = extractEventType(body).toLowerCase()
  if (isPortRejectionEventType(eventType)) return true
  const comment = buildPortingNotificationText(body).trim()
  if (!comment) return false
  const lower = comment.toLowerCase()
  return (
    looksLikePinPasscodeRejection(comment) ||
    lower.includes("rejected") ||
    lower.includes("rejection due to") ||
    (looksLikeCarrierRejection(comment) &&
      (lower.includes("failed") || lower.includes("cannot be ported")))
  )
}

/** Carrier / Telnyx porting desk left a comment (admin or system user_type in payload). */
export function hasCarrierAgentAuthor(body: Record<string, unknown>): boolean {
  return deepFindPortingCommentUserType(body) != null
}

function deepFindPortingCommentUserType(obj: unknown, depth = 0): string | null {
  if (depth > 14 || obj == null) return null
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>
    const ut = o.user_type
    if (typeof ut === "string") {
      const lower = ut.toLowerCase()
      if (lower === "admin" || lower === "system") return lower
    }
    for (const v of Object.values(o)) {
      const found = deepFindPortingCommentUserType(v, depth + 1)
      if (found) return found
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindPortingCommentUserType(item, depth + 1)
      if (found) return found
    }
  }
  return null
}

/** True when owner should see amber action_required (not a terminal rejection). */
export function isPortActionRequiredWebhook(body: Record<string, unknown>): boolean {
  if (isPortRejectionWebhook(body)) return false
  const record = extractPortingOrderRecord(body)
  if (record) {
    const statuses = collectPortingStatuses(record)
    if (statuses.length > 0 && pickBestPortingStatus(statuses) === "ported") return false
  }
  if (hasPortingCarrierExceptions(body)) return true
  const eventType = extractEventType(body).toLowerCase()
  if (eventType.includes("exception") || eventType.includes("action_required")) return true
  if (eventType.includes("comment") && hasCarrierAgentAuthor(body)) return true
  const comment = buildPortingNotificationText(body).trim()
  if (comment && hasCarrierAgentAuthor(body)) return true
  if (comment && looksLikeCarrierRejection(comment) && !looksLikePinPasscodeRejection(comment)) return true
  return false
}

const BILLING_PHONE_KEYS = [
  "billing_telephone_number",
  "billing_phone_number",
  "btn",
  "billing_telephone",
] as const

function deepFindBillingPhone(obj: unknown, depth = 0): string | null {
  if (depth > 14 || obj == null) return null
  if (typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>
    for (const key of BILLING_PHONE_KEYS) {
      const value = o[key]
      if (typeof value === "string" && value.replace(/\D/g, "").length >= 10) return value.trim()
    }
    for (const value of Object.values(o)) {
      const found = deepFindBillingPhone(value, depth + 1)
      if (found) return found
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindBillingPhone(item, depth + 1)
      if (found) return found
    }
  }
  return null
}

/** BTN / billing line from nested Telnyx porting payloads (e.g. +15025571219). */
export function extractBillingTelephoneNumber(body: Record<string, unknown>): string | null {
  const direct = deepFindBillingPhone(body)
  if (direct) return direct
  const nums = extractPortingPhoneNumbers(body)
  return nums[0] ?? null
}

/** Phone numbers listed on a Telnyx porting order payload. */
export function extractPortingPhoneNumbers(body: Record<string, unknown>): string[] {
  const record = extractPortingOrderRecord(body)
  const sources = record ? [record] : [body]
  const out: string[] = []
  for (const src of sources) {
    const nums = (src as Record<string, unknown>).phone_numbers
    if (!Array.isArray(nums)) continue
    for (const item of nums) {
      if (typeof item === "string" && item.trim()) {
        out.push(item.trim())
        continue
      }
      if (item && typeof item === "object") {
        const pn = (item as Record<string, unknown>).phone_number
        if (typeof pn === "string" && pn.trim()) out.push(pn.trim())
      }
    }
  }
  return [...new Set(out)]
}

/** Find the richest Telnyx porting-order object embedded in a webhook payload. */
export function extractPortingOrderRecord(body: Record<string, unknown>): Record<string, unknown> | null {
  const data = body.data as Record<string, unknown> | undefined
  const record = data?.record
  if (record && typeof record === "object" && !Array.isArray(record)) {
    return record as Record<string, unknown>
  }
  // Telnyx v2 port-in notifications nest the order under data.payload.
  const payload = data?.payload
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>
  }
  const po = body.porting_order ?? data?.porting_order
  if (po && typeof po === "object" && !Array.isArray(po)) {
    return po as Record<string, unknown>
  }
  return deepFindPortingOrderRecord(body)
}

function portingOrderStatusObject(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).value === "string"
  )
}

function deepFindPortingOrderRecord(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 14 || obj == null) return null
  if (typeof obj !== "object") return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindPortingOrderRecord(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const o = obj as Record<string, unknown>
  const statusObject = portingOrderStatusObject(o.status)
  const hasOrderStatus =
    typeof o.porting_order_status === "string" ||
    statusObject ||
    (typeof o.status === "string" && (o.phone_numbers != null || o.id != null))
  if (
    hasOrderStatus &&
    (o.phone_numbers != null || o.porting_order_status != null || statusObject)
  ) {
    return o
  }
  for (const v of Object.values(o)) {
    const found = deepFindPortingOrderRecord(v, depth + 1)
    if (found) return found
  }
  return null
}
