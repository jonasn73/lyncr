/**
 * Paint-cookie mirror of Latest Clear / opened stamps.
 * SSR cannot read localStorage — without this cookie, dismissed alerts flash then vanish.
 */

import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"

const LATEST_SEEN_COOKIE_SCOPE = "latest-seen"
export const LATEST_SEEN_COOKIE = paintSeedCookieName(LATEST_SEEN_COOKIE_SCOPE)

/** Compact seen maps — phone keys for replies, row ids for everything else. */
export type LatestSeenPaint = {
  replies: Record<string, string>
  items: Record<string, string>
}

const EMPTY: LatestSeenPaint = { replies: {}, items: {} }

/** Keep cookie small (shared 3.2KB paint budget). */
function truncateMap(map: Record<string, string>, max = 40): Record<string, string> {
  const entries = Object.entries(map)
    .filter(([k, v]) => k.length >= 1 && typeof v === "string" && Boolean(Date.parse(v)))
    .sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0))
    .slice(0, max)
  return Object.fromEntries(entries)
}

/** Prefer the newer ISO stamp when merging two seen maps. */
export function mergeSeenMaps(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = { ...(a ?? {}) }
  for (const [k, v] of Object.entries(b ?? {})) {
    const prev = out[k]
    if (!prev || (Date.parse(v) || 0) >= (Date.parse(prev) || 0)) {
      out[k] = v
    }
  }
  return out
}

function normalizeLatestSeenPaint(
  raw: LatestSeenPaint | null | undefined
): LatestSeenPaint {
  if (!raw || typeof raw !== "object") return EMPTY
  return {
    replies: truncateMap(raw.replies && typeof raw.replies === "object" ? raw.replies : {}),
    items: truncateMap(raw.items && typeof raw.items === "object" ? raw.items : {}),
  }
}

/** Write Clear/open stamps into the paint cookie (client). */
export function writeLatestSeenPaintCookie(paint: LatestSeenPaint): void {
  writePaintSeedCookie(LATEST_SEEN_COOKIE_SCOPE, normalizeLatestSeenPaint(paint))
}

/** Browser document.cookie read. */
export function readLatestSeenPaintCookie(): LatestSeenPaint {
  return normalizeLatestSeenPaint(
    readPaintSeedCookie<LatestSeenPaint>(LATEST_SEEN_COOKIE_SCOPE)
  )
}

/** Server / layout cookie jar read. */
export function readLatestSeenPaintFromCookieRaw(
  raw: string | null | undefined
): LatestSeenPaint {
  return normalizeLatestSeenPaint(
    readPaintSeedCookieValue<LatestSeenPaint>(raw)
  )
}
