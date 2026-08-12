// Track which Latest attention items the owner already opened (localStorage).
// Read replies leave Latest until a newer inbound arrives.
// Book-form + payment rows leave Latest once opened (detail / View booking / View).

import type { LatestCustomerAction } from "@/lib/latest-customer-actions"

const REPLY_STORAGE_KEY = "lyncr-latest-reply-seen-v1"
/** Stable Latest row ids (book_form / customer_paid) the owner already opened. */
const ITEM_STORAGE_KEY = "lyncr-latest-item-seen-v1"

/** Same-tab signal so Latest can drop a row without waiting for the next poll. */
export const LATEST_SEEN_CHANGED_EVENT = "lyncr:latest-seen-changed"

/** Last 10 digits — same phone key as Latest / Messages. */
export function latestPhoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

type SeenMap = Record<string, string>

function readMap(storageKey: string): SeenMap {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as SeenMap
  } catch {
    return {}
  }
}

function writeMap(storageKey: string, map: SeenMap) {
  if (typeof localStorage === "undefined") return
  try {
    // Keep the map bounded so localStorage does not grow forever.
    const entries = Object.entries(map)
      .filter(([k, v]) => k.length >= 1 && typeof v === "string" && Boolean(Date.parse(v)))
      .sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0))
      .slice(0, 200)
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* ignore quota / private mode */
  }
}

function notifySeenChanged(detail: { phoneKey?: string; itemId?: string }) {
  if (typeof window === "undefined") return
  try {
    window.dispatchEvent(new CustomEvent(LATEST_SEEN_CHANGED_EVENT, { detail }))
  } catch {
    /* ignore */
  }
}

/** When the owner last opened this phone’s Latest detail or Messages thread. */
export function getLatestReplySeenAt(phone: string): string | null {
  const key = latestPhoneKey(phone)
  if (key.length < 10) return null
  return readMap(REPLY_STORAGE_KEY)[key] ?? null
}

/** Mark a customer phone as seen (opens detail sheet or Messages). */
export function markLatestReplySeen(phone: string, at = new Date().toISOString()): void {
  const key = latestPhoneKey(phone)
  if (key.length < 10) return
  const map = readMap(REPLY_STORAGE_KEY)
  const prev = map[key]
  // Only move forward — never un-see a newer stamp with an older one.
  if (prev && (Date.parse(prev) || 0) >= (Date.parse(at) || 0)) {
    // Still notify so Latest can drop a row that was already stamped.
    notifySeenChanged({ phoneKey: key })
    return
  }
  map[key] = at
  writeMap(REPLY_STORAGE_KEY, map)
  notifySeenChanged({ phoneKey: key })
}

/**
 * True when there is a newer inbound reply than the last time the owner opened it.
 * Used to keep “Customer replied” rows in Latest only while unread.
 */
export function isLatestReplyUnread(phone: string, inboundAt: string): boolean {
  const inboundMs = Date.parse(inboundAt) || 0
  if (!inboundMs) return true
  const seen = getLatestReplySeenAt(phone)
  if (!seen) return true
  return inboundMs > (Date.parse(seen) || 0)
}

/**
 * Events that leave Latest as soon as the owner opens them (not job_finished).
 * Payment rows that still need Thanks + review stay until that SMS is sent
 * (same persistence as a standalone job_finished alert).
 */
export function isDismissOnOpenLatestEvent(
  event: LatestCustomerAction["event"],
  item?: Pick<LatestCustomerAction, "thanksReviewPending"> | null
): boolean {
  if (event === "customer_paid" && item?.thanksReviewPending) return false
  return event === "book_form" || event === "customer_paid"
}

/** When the owner last opened this Latest row (book form / payment). */
export function getLatestItemSeenAt(itemId: string): string | null {
  const id = itemId.trim()
  if (!id) return null
  return readMap(ITEM_STORAGE_KEY)[id] ?? null
}

/**
 * Mark a Latest attention row as seen (detail sheet, View booking, or View).
 * Persists so the row stays gone after refresh / next poll.
 */
export function markLatestItemSeen(itemId: string, at = new Date().toISOString()): void {
  const id = itemId.trim()
  if (!id) return
  const map = readMap(ITEM_STORAGE_KEY)
  const prev = map[id]
  if (prev && (Date.parse(prev) || 0) >= (Date.parse(at) || 0)) {
    notifySeenChanged({ itemId: id })
    return
  }
  map[id] = at
  writeMap(ITEM_STORAGE_KEY, map)
  notifySeenChanged({ itemId: id })
}

/** True until the owner opens this book-form / payment Latest row. */
export function isLatestItemUnread(itemId: string): boolean {
  return !getLatestItemSeenAt(itemId)
}

/**
 * Drop Latest rows the owner already opened:
 * - customer replies (until a newer inbound)
 * - book_form / customer_paid (until a new submit / payment id)
 * Job-finished “needs review text” rows stay until Thanks + review is sent.
 */
export function excludeReadRepliesFromLatest(
  items: LatestCustomerAction[]
): LatestCustomerAction[] {
  return items.filter((item) => {
    if (item.event === "replied") {
      const inboundAt = item.lastInbound?.created_at
      if (!inboundAt) return true
      return isLatestReplyUnread(item.customerPhone, inboundAt)
    }
    if (isDismissOnOpenLatestEvent(item.event, item)) {
      return isLatestItemUnread(item.id)
    }
    return true
  })
}

/**
 * Persist + same-tab notify when the owner opens a Latest attention item.
 * Replies use phone stamps; book forms / payments use row id.
 * job_finished (and paid+thanks-pending) stay until Send.
 */
export function markLatestAttentionOpened(item: LatestCustomerAction): void {
  if (item.event === "replied" && item.customerPhone) {
    markLatestReplySeen(item.customerPhone)
    return
  }
  if (isDismissOnOpenLatestEvent(item.event, item) && item.id) {
    markLatestItemSeen(item.id)
  }
}
