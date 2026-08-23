/**
 * Compact missed-leads summary for hard-refresh SSR.
 *
 * Full call rows stay in sessionStorage (too large for cookies). The ticker only
 * needs uniqueLeadsToday + totalMissedToday so “1 leads” can land in first HTML
 * alongside MISSED from routing-telemetry.
 */

import { telemetryLocalDayPeriodKey } from "@/lib/daily-call-telemetry"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import type { MissedLeadCallRow, MissedLeadHotProspect } from "@/lib/missed-lead-aggregation"

/** Cookie + session scope for the MISSED ticker sublabel seed. */
export const MISSED_LEADS_CACHE_SCOPE = "missed-lead-insights"
export const MISSED_LEADS_CACHE_KEY = persistedCacheKey(MISSED_LEADS_CACHE_SCOPE, "banner")
export const MISSED_LEADS_COOKIE = paintSeedCookieName(MISSED_LEADS_CACHE_SCOPE)

/** Session payload — rows for banner + summary for ticker. */
export type MissedLeadsSessionCache = {
  rows: MissedLeadCallRow[]
  recentUnreturned: MissedLeadHotProspect[]
  uniqueLeadsToday: number
  totalMissedToday: number
  localDayPeriodKey?: string
  /** epoch ms when this cache was written — see fetchedAtMs on MissedLeadsPaintSeed. */
  fetchedAtMs?: number
}

/** Tiny cookie / SSR paint seed — counts only (fits 4KB budget). */
export type MissedLeadsPaintSeed = {
  uniqueLeadsToday: number
  totalMissedToday: number
  localDayPeriodKey?: string
  /** epoch ms when this seed was written — drops stale-but-same-day seeds (see routing-telemetry-cache). */
  fetchedAtMs?: number
}

const EMPTY_SEED: MissedLeadsPaintSeed = {
  uniqueLeadsToday: 0,
  totalMissedToday: 0,
}

/**
 * Older than this, a same-day seed is still "today" but the lead count has likely
 * already moved — showing it confidently and then silently rewriting on the first
 * live /api/calls fetch is the same "confident value that flips" flash fixed for
 * routing-telemetry-cache. Treat it as no seed instead.
 */
const MISSED_LEADS_SEED_FRESH_MS = 2 * 60 * 1000

function isMissedLeadsSeedFresh(seed: MissedLeadsPaintSeed, now: number): boolean {
  // No timestamp = a legacy cache entry from before this field existed — treat as stale.
  if (typeof seed.fetchedAtMs !== "number") return false
  return now - seed.fetchedAtMs <= MISSED_LEADS_SEED_FRESH_MS
}

/** Drop yesterday’s counts so “1 leads” does not stick across midnight. */
export function normalizeMissedLeadsPaintSeed(
  raw: MissedLeadsPaintSeed | null | undefined,
  now: Date = new Date()
): MissedLeadsPaintSeed | null {
  if (!raw || typeof raw.uniqueLeadsToday !== "number" || typeof raw.totalMissedToday !== "number") {
    return null
  }
  if (raw.uniqueLeadsToday < 0 || raw.totalMissedToday < 0) return null
  const dayKey = telemetryLocalDayPeriodKey(now)
  const sameDay = !raw.localDayPeriodKey || raw.localDayPeriodKey === dayKey
  if (!sameDay) {
    return { uniqueLeadsToday: 0, totalMissedToday: 0, localDayPeriodKey: dayKey }
  }
  if (!isMissedLeadsSeedFresh(raw, now.getTime())) return null
  return {
    uniqueLeadsToday: raw.uniqueLeadsToday,
    totalMissedToday: raw.totalMissedToday,
    localDayPeriodKey: dayKey,
    fetchedAtMs: raw.fetchedAtMs,
  }
}

function isValidSeed(raw: MissedLeadsPaintSeed | null | undefined): raw is MissedLeadsPaintSeed {
  return Boolean(
    raw &&
      typeof raw.uniqueLeadsToday === "number" &&
      typeof raw.totalMissedToday === "number" &&
      raw.uniqueLeadsToday >= 0 &&
      raw.totalMissedToday >= 0
  )
}

/**
 * Paint seed first (SSR HTML), then session, then document cookie.
 * Prefer paint over session when both exist (React #418).
 */
export function readMissedLeadsPaintSeed(
  paint?: MissedLeadsPaintSeed | null
): MissedLeadsPaintSeed | null {
  const fromPaint = normalizeMissedLeadsPaintSeed(paint)
  if (fromPaint) return fromPaint

  const fromSession = readPersistedCache<MissedLeadsSessionCache>(MISSED_LEADS_CACHE_KEY)
  if (fromSession && typeof fromSession.uniqueLeadsToday === "number") {
    return normalizeMissedLeadsPaintSeed({
      uniqueLeadsToday: fromSession.uniqueLeadsToday,
      totalMissedToday: fromSession.totalMissedToday ?? 0,
      localDayPeriodKey: fromSession.localDayPeriodKey,
      fetchedAtMs: fromSession.fetchedAtMs,
    })
  }

  const fromCookie = normalizeMissedLeadsPaintSeed(
    readPaintSeedCookie<MissedLeadsPaintSeed>(MISSED_LEADS_CACHE_SCOPE)
  )
  return fromCookie
}

/** Read missed-leads paint cookie from Next.js cookies().get(name)?.value. */
export function readMissedLeadsFromCookieRaw(
  cookieRaw: string | null | undefined
): MissedLeadsPaintSeed | null {
  return normalizeMissedLeadsPaintSeed(
    readPaintSeedCookieValue<MissedLeadsPaintSeed>(cookieRaw)
  )
}

/** True when we already know last-paint leads counts (including confirmed 0). */
export function hasMissedLeadsSeed(paint?: MissedLeadsPaintSeed | null): boolean {
  const fromSession = readPersistedCache<MissedLeadsSessionCache>(MISSED_LEADS_CACHE_KEY)
  if (
    fromSession &&
    (Array.isArray(fromSession.rows) || typeof fromSession.uniqueLeadsToday === "number")
  ) {
    return true
  }
  if (isValidSeed(paint)) return true
  return isValidSeed(readPaintSeedCookie<MissedLeadsPaintSeed>(MISSED_LEADS_CACHE_SCOPE))
}

/** Persist after /api/calls summarises — session rows + tiny cookie for SSR. */
export function writeMissedLeadsCache(next: MissedLeadsSessionCache): void {
  const dayKey = next.localDayPeriodKey ?? telemetryLocalDayPeriodKey()
  const fetchedAtMs = Date.now()
  const sessionPayload: MissedLeadsSessionCache = {
    rows: Array.isArray(next.rows) ? next.rows : [],
    recentUnreturned: Array.isArray(next.recentUnreturned) ? next.recentUnreturned : [],
    uniqueLeadsToday: next.uniqueLeadsToday,
    totalMissedToday: next.totalMissedToday,
    localDayPeriodKey: dayKey,
    fetchedAtMs,
  }
  writePersistedCache(MISSED_LEADS_CACHE_KEY, sessionPayload)
  // Cookie stays tiny — ticker sublabel only; banner still waits for session rows / fetch.
  writePaintSeedCookie(MISSED_LEADS_CACHE_SCOPE, {
    uniqueLeadsToday: next.uniqueLeadsToday,
    totalMissedToday: next.totalMissedToday,
    localDayPeriodKey: dayKey,
    fetchedAtMs,
  } satisfies MissedLeadsPaintSeed)
}

export { EMPTY_SEED as EMPTY_MISSED_LEADS_PAINT_SEED }
