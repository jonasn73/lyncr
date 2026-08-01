// Track which inbound Latest replies the owner has already opened (localStorage).
// Read replies leave Latest until a newer inbound arrives.

import type { LatestCustomerAction } from "@/lib/latest-customer-actions"

const STORAGE_KEY = "lyncr-latest-reply-seen-v1"

/** Same-tab signal so Latest can drop a row without waiting for the next poll. */
export const LATEST_SEEN_CHANGED_EVENT = "lyncr:latest-seen-changed"

/** Last 10 digits — same phone key as Latest / Messages. */
export function latestPhoneKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

type SeenMap = Record<string, string>

function readMap(): SeenMap {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as SeenMap
  } catch {
    return {}
  }
}

function writeMap(map: SeenMap) {
  if (typeof localStorage === "undefined") return
  try {
    // Keep the map bounded so localStorage does not grow forever.
    const entries = Object.entries(map)
      .filter(([k, v]) => k.length >= 10 && typeof v === "string" && Boolean(Date.parse(v)))
      .sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0))
      .slice(0, 200)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* ignore quota / private mode */
  }
}

function notifySeenChanged(phoneKey: string) {
  if (typeof window === "undefined") return
  try {
    window.dispatchEvent(
      new CustomEvent(LATEST_SEEN_CHANGED_EVENT, { detail: { phoneKey } })
    )
  } catch {
    /* ignore */
  }
}

/** When the owner last opened this phone’s Latest detail or Messages thread. */
export function getLatestReplySeenAt(phone: string): string | null {
  const key = latestPhoneKey(phone)
  if (key.length < 10) return null
  return readMap()[key] ?? null
}

/** Mark a customer phone as seen (opens detail sheet or Messages). */
export function markLatestReplySeen(phone: string, at = new Date().toISOString()): void {
  const key = latestPhoneKey(phone)
  if (key.length < 10) return
  const map = readMap()
  const prev = map[key]
  // Only move forward — never un-see a newer stamp with an older one.
  if (prev && (Date.parse(prev) || 0) >= (Date.parse(at) || 0)) {
    // Still notify so Latest can drop a row that was already stamped.
    notifySeenChanged(key)
    return
  }
  map[key] = at
  writeMap(map)
  notifySeenChanged(key)
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
 * Drop customer-reply Latest rows the owner already opened.
 * Job-finished “needs review text” rows stay until Thanks + review is sent.
 */
export function excludeReadRepliesFromLatest(
  items: LatestCustomerAction[]
): LatestCustomerAction[] {
  return items.filter((item) => {
    if (item.event !== "replied") return true
    const inboundAt = item.lastInbound?.created_at
    if (!inboundAt) return true
    return isLatestReplyUnread(item.customerPhone, inboundAt)
  })
}
