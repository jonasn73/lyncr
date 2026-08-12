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

type PresenceCache = { status: PresenceStatus }

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
  if (isValidStatus(paint)) return paint

  const fromSession = readPersistedCache<PresenceCache>(PRESENCE_SESSION_KEY)
  const sessionStatus = parsePresenceStatus(fromSession?.status)
  if (isValidStatus(sessionStatus)) return sessionStatus

  const fromCookie = readPaintSeedCookie<PresenceCache>(PRESENCE_CACHE_SCOPE)
  return parsePresenceStatus(fromCookie?.status)
}

/** Read presence paint cookie from Next.js cookies().get(name)?.value. */
export function readPresencePaintFromCookieRaw(
  cookieRaw: string | null | undefined
): PresenceStatus | null {
  const parsed = readPaintSeedCookieValue<PresenceCache>(cookieRaw)
  return parsePresenceStatus(parsed?.status)
}

/** Persist after a successful presence fetch (session + cookie). */
export function writeCachedPresence(status: PresenceStatus): void {
  writePersistedCache(PRESENCE_SESSION_KEY, { status } satisfies PresenceCache)
  writePaintSeedCookie(PRESENCE_CACHE_SCOPE, { status } satisfies PresenceCache)
}
