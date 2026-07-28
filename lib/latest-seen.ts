// Track which inbound Latest replies the owner has already opened (localStorage v1).

const STORAGE_KEY = "lyncr-latest-reply-seen-v1"

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
  if (prev && (Date.parse(prev) || 0) >= (Date.parse(at) || 0)) return
  map[key] = at
  writeMap(map)
}

/**
 * True when there is a newer inbound reply than the last time the owner opened it.
 * Used for the unread dot (status stays “Needs reply” until they text back).
 */
export function isLatestReplyUnread(phone: string, inboundAt: string): boolean {
  const inboundMs = Date.parse(inboundAt) || 0
  if (!inboundMs) return true
  const seen = getLatestReplySeenAt(phone)
  if (!seen) return true
  return inboundMs > (Date.parse(seen) || 0)
}
