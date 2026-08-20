/**
 * Compact cookie mirrors of session paint caches.
 *
 * sessionStorage survives hard refresh but is invisible to SSR — so the first
 * HTML still paints "—" / blank until JS hydrates. These cookies let the
 * server seed the same last-known values into the first HTML.
 *
 * Do NOT use for large payloads (Latest is truncated by callers).
 */

const COOKIE_PREFIX = "lyncr_paint_"
const CACHE_VERSION = 1
/** Keep under typical 4KB cookie limits. */
const MAX_COOKIE_CHARS = 3200
/** Match session cache TTL (~30 min). */
const MAX_AGE_SEC = 30 * 60

type PaintEnvelope<T> = {
  v: number
  t: number
  d: T
}

/** Cookie name for a paint scope — used by server layout + client writers. */
export function paintSeedCookieName(scope: string): string {
  return `${COOKIE_PREFIX}${scope}`
}

function parseEnvelope<T>(raw: string | null | undefined, maxAgeMs = MAX_AGE_SEC * 1000): T | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as PaintEnvelope<T>
    if (!parsed || parsed.v !== CACHE_VERSION || parsed.d === undefined) return undefined
    if (Date.now() - parsed.t > maxAgeMs) return undefined
    return parsed.d
  } catch {
    return undefined
  }
}

/** Write a paint-seed cookie (client only). Returns false when oversized or private mode. */
export function writePaintSeedCookie(scope: string, data: unknown): boolean {
  if (typeof document === "undefined") return false
  try {
    const envelope: PaintEnvelope<unknown> = { v: CACHE_VERSION, t: Date.now(), d: data }
    const payload = JSON.stringify(envelope)
    if (payload.length > MAX_COOKIE_CHARS) return false
    document.cookie = `${paintSeedCookieName(scope)}=${encodeURIComponent(payload)}; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax`
    return true
  } catch {
    return false
  }
}

/** Read a paint-seed cookie from document.cookie (browser). */
export function readPaintSeedCookie<T>(scope: string): T | undefined {
  if (typeof document === "undefined") return undefined
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${paintSeedCookieName(scope).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
    )
    if (!match?.[1]) return undefined
    return parseEnvelope<T>(decodeURIComponent(match[1]))
  } catch {
    return undefined
  }
}

/** Read a paint-seed cookie from Next.js cookies().get(name)?.value. */
export function readPaintSeedCookieValue<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined
  try {
    return parseEnvelope<T>(decodeURIComponent(raw))
  } catch {
    try {
      return parseEnvelope<T>(raw)
    } catch {
      return undefined
    }
  }
}

/** Delete a paint-seed cookie (logout / org switch — stop stale SSR flash). */
export function clearPaintSeedCookie(scope: string): void {
  if (typeof document === "undefined") return
  try {
    document.cookie = `${paintSeedCookieName(scope)}=; Path=/; Max-Age=0; SameSite=Lax`
  } catch {
    /* ignore */
  }
}
