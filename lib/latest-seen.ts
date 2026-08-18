// Track which Latest attention items the owner already opened (localStorage + paint cookie).
// Read replies leave Latest until a newer inbound arrives.
// Book-form leftovers stay until Book, Call, or Clear — looking is not done.
// Payment rows leave Latest once opened (detail / View).
// Paint cookie mirrors stamps so SSR first paint matches Clear/open (no flash).

import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import {
  mergeSeenMaps,
  readLatestSeenPaintCookie,
  writeLatestSeenPaintCookie,
  type LatestSeenPaint,
} from "@/lib/latest-seen-paint"

const REPLY_STORAGE_KEY = "lyncr-latest-reply-seen-v1"
/** Stable Latest row ids (book_form / customer_paid / Clear) the owner already opened. */
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

/** Push localStorage seen maps into the paint cookie for the next SSR. */
function syncSeenPaintCookie() {
  if (typeof document === "undefined") return
  const fromLs: LatestSeenPaint = {
    replies: readMap(REPLY_STORAGE_KEY),
    items: readMap(ITEM_STORAGE_KEY),
  }
  // Merge so a briefly stale localStorage cannot wipe a newer cookie stamp.
  const fromCookie = readLatestSeenPaintCookie()
  writeLatestSeenPaintCookie({
    replies: mergeSeenMaps(fromCookie.replies, fromLs.replies),
    items: mergeSeenMaps(fromCookie.items, fromLs.items),
  })
}

/** Call once on Lines mount — older Clear stamps may only live in localStorage. */
export function ensureLatestSeenPaintCookieSynced(): void {
  syncSeenPaintCookie()
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
  syncSeenPaintCookie()
}

function notifySeenChanged(detail: { phoneKey?: string; itemId?: string }) {
  if (typeof window === "undefined") return
  try {
    window.dispatchEvent(new CustomEvent(LATEST_SEEN_CHANGED_EVENT, { detail }))
  } catch {
    /* ignore */
  }
}

/**
 * Merge paint-cookie + localStorage seen maps (newer stamp wins).
 * SSR passes paint only; browser merges both so Clear never flashes back.
 */
export function resolveLatestSeenPaint(
  paint?: LatestSeenPaint | null
): LatestSeenPaint {
  const fromPaint = paint ?? { replies: {}, items: {} }
  if (typeof localStorage === "undefined") {
    return {
      replies: { ...fromPaint.replies },
      items: { ...fromPaint.items },
    }
  }
  return {
    replies: mergeSeenMaps(fromPaint.replies, readMap(REPLY_STORAGE_KEY)),
    items: mergeSeenMaps(fromPaint.items, readMap(ITEM_STORAGE_KEY)),
  }
}

/** When the owner last opened this phone’s Latest detail or Messages thread. */
export function getLatestReplySeenAt(
  phone: string,
  paint?: LatestSeenPaint | null
): string | null {
  const key = latestPhoneKey(phone)
  if (key.length < 10) return null
  return resolveLatestSeenPaint(paint).replies[key] ?? null
}

/** Mark a customer phone as seen (opens detail sheet or Messages). */
export function markLatestReplySeen(phone: string, at = new Date().toISOString()): void {
  const key = latestPhoneKey(phone)
  if (key.length < 10) return
  const map = readMap(REPLY_STORAGE_KEY)
  const prev = map[key]
  // Only move forward — never un-see a newer stamp with an older one.
  if (prev && (Date.parse(prev) || 0) >= (Date.parse(at) || 0)) {
    syncSeenPaintCookie()
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
export function isLatestReplyUnread(
  phone: string,
  inboundAt: string,
  paint?: LatestSeenPaint | null
): boolean {
  const inboundMs = Date.parse(inboundAt) || 0
  if (!inboundMs) return true
  const seen = getLatestReplySeenAt(phone, paint)
  if (!seen) return true
  return inboundMs > (Date.parse(seen) || 0)
}

/**
 * Events that leave Latest as soon as the owner opens them (not job_finished).
 * Book forms do not — peeking at View booking must not hide an open leftover.
 * Payment rows that still need Thanks + review stay until that SMS is sent.
 */
export function isDismissOnOpenLatestEvent(
  event: LatestCustomerAction["event"],
  item?: Pick<LatestCustomerAction, "thanksReviewPending"> | null
): boolean {
  // Paid + thanks still needed stays like a job-finished alert.
  if (event === "customer_paid" && item?.thanksReviewPending) return false
  // Leftover book jobs stay on home until Book, Call, or Clear.
  if (event === "book_form") return false
  return event === "customer_paid"
}

/** When the owner last opened this Latest row (book form / payment). */
export function getLatestItemSeenAt(
  itemId: string,
  paint?: LatestSeenPaint | null
): string | null {
  const id = itemId.trim()
  if (!id) return null
  return resolveLatestSeenPaint(paint).items[id] ?? null
}

/**
 * Mark a Latest attention row as seen (Clear, Book, Call, or payment View).
 * Persists so the row stays gone after refresh / next poll.
 */
export function markLatestItemSeen(itemId: string, at = new Date().toISOString()): void {
  const id = itemId.trim()
  if (!id) return
  const map = readMap(ITEM_STORAGE_KEY)
  const prev = map[id]
  if (prev && (Date.parse(prev) || 0) >= (Date.parse(at) || 0)) {
    syncSeenPaintCookie()
    notifySeenChanged({ itemId: id })
    return
  }
  map[id] = at
  writeMap(ITEM_STORAGE_KEY, map)
  notifySeenChanged({ itemId: id })
}

/** True until the owner opens this book-form / payment Latest row. */
export function isLatestItemUnread(
  itemId: string,
  paint?: LatestSeenPaint | null
): boolean {
  return !getLatestItemSeenAt(itemId, paint)
}

/**
 * Drop Latest rows the owner already opened or Cleared:
 * - customer replies (until a newer inbound)
 * - book_form / customer_paid (until a new submit / payment id)
 * - job_finished / paid+thanks (until Clear, or Thanks is sent and the API stops returning them)
 *
 * Pass `paint` on SSR so dismissed rows never paint in the first HTML.
 */
export function excludeReadRepliesFromLatest(
  items: LatestCustomerAction[],
  paint?: LatestSeenPaint | null
): LatestCustomerAction[] {
  const seen = resolveLatestSeenPaint(paint)
  return items.filter((item) => {
    if (item.event === "replied") {
      const inboundAt = item.lastInbound?.created_at
      if (!inboundAt) return true
      return isLatestReplyUnread(item.customerPhone, inboundAt, seen)
    }
    // Opened (book/paid) or Cleared (any non-reply) — row id stamped.
    if (item.id && !isLatestItemUnread(item.id, seen)) return false
    return true
  })
}

/**
 * Owner tapped Clear — hide this alert without opening it.
 * Replies use the phone stamp; everything else uses the row id.
 */
export function dismissLatestAlert(item: LatestCustomerAction): void {
  if (item.event === "replied" && item.customerPhone) {
    markLatestReplySeen(item.customerPhone)
    return
  }
  if (item.id) {
    markLatestItemSeen(item.id)
  }
}

/**
 * Persist + same-tab notify when the owner opens a Latest attention item.
 * Replies use phone stamps; payments use row id.
 * Book forms stay until Book / Call / Clear (use dismissLatestAlert).
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
