/**
 * Presence Busy/Available cache — session + paint cookie for hard-refresh SSR.
 */

import type { PresenceStatus } from "@/lib/account-presence"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export const PRESENCE_CACHE_SCOPE = "account-presence"
export const PRESENCE_SESSION_KEY = persistedCacheKey(PRESENCE_CACHE_SCOPE, "status")
export const PRESENCE_COOKIE = paintSeedCookieName(PRESENCE_CACHE_SCOPE)

type PresenceCache = { status: PresenceStatus; fetchedAtMs?: number }

/**
 * Older than this, a cached Busy/Available status may no longer be true — changed from
 * another device, or an ON_JOB "busy until" window that already expired server-side.
 * Showing it confidently and then silently rewriting once refresh() resolves is the same
 * "confident value that flips" flash fixed for routing-telemetry-cache. Treat it as no
 * seed instead (caller falls back to null — presenceReady stays false until the live fetch).
 */
const PRESENCE_SEED_FRESH_MS = 2 * 60 * 1000

function isPresenceSeedFresh(cache: PresenceCache | null | undefined, now: number): boolean {
  if (!cache || typeof cache.fetchedAtMs !== "number") return false
  return now - cache.fetchedAtMs <= PRESENCE_SEED_FRESH_MS
}

function parsePresenceStatus(raw: string | undefined | null): PresenceStatus | null {
  if (!raw) return null
  const upper = String(raw).toUpperCase()
  if (upper === "ON_JOB") return "ON_JOB"
  if (upper === "CLOSED") return "CLOSED"
  if (upper === "AVAILABLE") return "AVAILABLE"
  return null
}

function isValidStatus(s: PresenceStatus | null | undefined): s is PresenceStatus {
  return s === "AVAILABLE" || s === "ON_JOB" || s === "CLOSED"
}

/**
 * Paint seed first (SSR HTML), then session, then cookie.
 * Pass `paint` from useDashboardPaintSeeds().presence during React render/SSR.
 * Prefer paint over session when both exist (React #418).
 */
export function readCachedPresence(paint?: PresenceStatus | null): PresenceStatus | null {
  // `paint` already passed through readPresencePaintFromCookieRaw's freshness gate below.
  if (isValidStatus(paint)) return paint

  const now = Date.now()
  const fromSession = readPersistedCache<PresenceCache>(PRESENCE_SESSION_KEY)
  const sessionStatus = parsePresenceStatus(fromSession?.status)
  if (isValidStatus(sessionStatus) && isPresenceSeedFresh(fromSession, now)) return sessionStatus

  const fromCookie = readPaintSeedCookie<PresenceCache>(PRESENCE_CACHE_SCOPE)
  if (!isPresenceSeedFresh(fromCookie, now)) return null
  return parsePresenceStatus(fromCookie?.status)
}

/** Read presence paint cookie from Next.js cookies().get(name)?.value. */
export function readPresencePaintFromCookieRaw(
  cookieRaw: string | null | undefined
): PresenceStatus | null {
  const parsed = readPaintSeedCookieValue<PresenceCache>(cookieRaw)
  if (!isPresenceSeedFresh(parsed, Date.now())) return null
  return parsePresenceStatus(parsed?.status)
}

/** Persist after a successful presence fetch (session + cookie). */
export function writeCachedPresence(status: PresenceStatus): void {
  const fetchedAtMs = Date.now()
  writePersistedCache(PRESENCE_SESSION_KEY, { status, fetchedAtMs } satisfies PresenceCache)
  writePaintSeedCookie(PRESENCE_CACHE_SCOPE, { status, fetchedAtMs } satisfies PresenceCache)
}
