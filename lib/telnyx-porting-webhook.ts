// ============================================
// Telnyx porting webhook — parse payloads into Sigo rows
// ============================================
// Telnyx sends several JSON shapes (event_type at root vs meta, nested porting_order, etc.).
// We walk the tree for `customer_reference` starting with `zing-` and stable event ids.

/** Find `customer_reference` like `zing-<uuid>` anywhere in the payload. */
export function findZingCustomerReference(obj: unknown): string | null {
  if (obj == null) return null
  if (typeof obj === "string") return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findZingCustomerReference(item)
      if (r) return r
    }
    return null
  }
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>
    const cr = o.customer_reference
    if (typeof cr === "string" && cr.startsWith("zing-")) return cr
    for (const k of Object.keys(o)) {
      const r = findZingCustomerReference(o[k])
      if (r) return r
    }
  }
  return null
}

export function customerRefToUserId(ref: string): string | null {
  const t = ref.trim()
  if (!t.startsWith("zing-")) return null
  const id = t.slice(5).trim()
  return id.length > 0 ? id : null
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
