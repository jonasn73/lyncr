/**
 * Compact cookie mirrors of session paint caches.
 *
 * sessionStorage survives hard refresh but is invisible to SSR — so the first
 * HTML still paints "—" / blank until JS hydrates. These cookies let the
 * server seed the same last-known values into the first HTML.
 *
 * Do NOT use for large payloads (Latest is truncated by callers).
 */

import { browserSessionCacheReadsAllowed } from "@/lib/swr/persisted-cache"

const COOKIE_PREFIX = "lyncr_paint_"
const CACHE_VERSION = 1
/** Keep under typical 4KB cookie limits. */
const MAX_COOKIE_CHARS = 3200
/** Match session cache TTL (~24h) so hard refresh still gets chrome paint. */
const MAX_AGE_SEC = 24 * 60 * 60

type PaintEnvelope<T> = {
  v: number
  t: number
  d: T
}

/**
 * Same cookie string → same object reference.
 * Without this, every render parses a new object and effects that depend on
 * paint seeds can loop (React #185 maximum update depth).
 */
const paintCookieCache = new Map<string, { raw: string; value: unknown }>()

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
    // Browsers cap ~4KB on the whole Set-Cookie line — measure the encoded value.
    const encoded = encodeURIComponent(payload)
    if (encoded.length > MAX_COOKIE_CHARS) return false
    document.cookie = `${paintSeedCookieName(scope)}=${encoded}; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax`
    // Drop cache so the next read picks up the new cookie value.
    paintCookieCache.delete(scope)
    return true
  } catch {
    return false
  }
}

/**
 * Read a paint-seed cookie from document.cookie (browser).
 *
 * Gated behind the same browserSessionCacheReadsAllowed() flag as sessionStorage
 * (lib/swr/persisted-cache.ts): document.cookie is a client-only source just like
 * sessionStorage, and reading it during React's first hydration render — before the
 * SessionCacheHydrationGate's useLayoutEffect unlocks it — can return a value SSR could
 * never have produced (SSR seeds from the request's Cookie header via readPaintSeedCookieValue,
 * a separate, already-consistent path). Reading it too early caused a real hydration mismatch
 * (server empty, client painting a stale cached value) that made React discard and regenerate
 * the whole subtree — a visible flash. Skipping the read until the gate flips means the first
 * hydration render matches SSR, and useSessionSeed's revisionKey (which includes the gate's
 * ready state) re-reads the real value on the very next render, before paint.
 */
export function readPaintSeedCookie<T>(scope: string): T | undefined {
  if (typeof document === "undefined") return undefined
  if (!browserSessionCacheReadsAllowed()) return undefined
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${paintSeedCookieName(scope).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
    )
    if (!match?.[1]) return undefined
    const raw = match[1]
    const hit = paintCookieCache.get(scope)
    if (hit && hit.raw === raw) return hit.value as T
    const value = parseEnvelope<T>(decodeURIComponent(raw))
    paintCookieCache.set(scope, { raw, value })
    return value
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
    paintCookieCache.delete(scope)
  } catch {
    /* ignore */
  }
}
