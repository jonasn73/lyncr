/**
 * Tiny Lines “Today · Answer · Press 1 · Left” seed for hard refresh.
 *
 * The hold-queue card used to start with stats = null, so the bar vanished
 * until /api/calls/queue came back — everything under it jumped. Cookie +
 * session keep last-known counts in the first HTML.
 *
 * Day rollover uses the owner’s IANA zone (not the Vercel UTC clock), so
 * 8pm Eastern does not look like “tomorrow” on the server.
 */

import { localDateTimePartsInZone } from "@/lib/schedule-blockouts"
import {
  DEFAULT_TELEMETRY_TIMEZONE,
  sanitizeIanaTimezone,
} from "@/lib/telemetry-timezone"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Cookie + session scope name for hold-queue day rollup. */
export const HOLD_QUEUE_STATS_CACHE_SCOPE = "hold-queue-day-stats"
/** sessionStorage key used by the persisted cache helper. */
export const HOLD_QUEUE_STATS_CACHE_KEY = persistedCacheKey(HOLD_QUEUE_STATS_CACHE_SCOPE, "today")
/** Cookie name the dashboard layout reads on the server. */
export const HOLD_QUEUE_STATS_COOKIE = paintSeedCookieName(HOLD_QUEUE_STATS_CACHE_SCOPE)

/** Light today rollup — same shape as GET /api/calls/queue stats. */
export type HoldQueueDayStats = {
  /** People still waiting (live). */
  waiting: number
  /** Answered from the queue today. */
  answered: number
  /** Pressed 1 (booking text) today. */
  press1: number
  /** Left / timed out today. */
  abandoned: number
  /** Average wait seconds for finished legs today, or null. */
  avgWaitSecs: number | null
  /** Local calendar day this seed belongs to (YYYY-MM-DD). */
  localDayPeriodKey?: string
  /** IANA zone used to stamp localDayPeriodKey. */
  timeZone?: string
}

/** True when the compact Today bar should paint (any finished activity). */
export function holdQueueStatsHaveTodayActivity(
  stats: HoldQueueDayStats | null | undefined
): stats is HoldQueueDayStats {
  // Missing stats → nothing to show.
  if (!stats) return false
  // Answer, Press 1, or Left must be above zero (waiting uses the amber card).
  return stats.answered > 0 || stats.press1 > 0 || stats.abandoned > 0
}

/** Drop yesterday’s counts so last night’s Left 3 does not stick after midnight. */
export function normalizeHoldQueueStatsPaintSeed(
  raw: HoldQueueDayStats | null | undefined,
  now: Date = new Date()
): HoldQueueDayStats | null {
  // Reject junk / missing payloads.
  if (!raw || typeof raw.answered !== "number" || typeof raw.press1 !== "number") return null
  // Abandoned is required for the Left count.
  if (typeof raw.abandoned !== "number") return null
  // Negative counts are invalid.
  if (raw.answered < 0 || raw.press1 < 0 || raw.abandoned < 0) return null
  // Owner zone from the cookie, or Eastern default — never the host machine’s local date.
  const tz = sanitizeIanaTimezone(raw.timeZone || DEFAULT_TELEMETRY_TIMEZONE)
  // Calendar day in that zone (8pm Louisville is still today, not UTC tomorrow).
  const dayKey = localDateTimePartsInZone(now, tz).dateKey
  // Missing key = treat as today (legacy cookies written before we stored the day).
  const sameDay = !raw.localDayPeriodKey || raw.localDayPeriodKey === dayKey
  // Stale day → zeros so we do not paint yesterday after local midnight.
  if (!sameDay) {
    return {
      waiting: 0,
      answered: 0,
      press1: 0,
      abandoned: 0,
      avgWaitSecs: null,
      localDayPeriodKey: dayKey,
      timeZone: tz,
    }
  }
  // Same day — keep numbers, stamp the day key + zone.
  return {
    waiting: typeof raw.waiting === "number" && raw.waiting >= 0 ? raw.waiting : 0,
    answered: raw.answered,
    press1: raw.press1,
    abandoned: raw.abandoned,
    avgWaitSecs:
      raw.avgWaitSecs != null && Number.isFinite(Number(raw.avgWaitSecs))
        ? Number(raw.avgWaitSecs)
        : null,
    localDayPeriodKey: dayKey,
    timeZone: tz,
  }
}

/**
 * Paint seed first (SSR HTML), then session, then document cookie.
 * Prefer paint over session when both exist (React hydration match).
 */
export function readHoldQueueStatsPaintSeed(
  paint?: HoldQueueDayStats | null
): HoldQueueDayStats | null {
  // Layout cookie parsed on the server — first HTML can include the Today bar.
  const fromPaint = normalizeHoldQueueStatsPaintSeed(paint)
  if (fromPaint) return fromPaint

  // Same-tab hard refresh: sessionStorage still has last counts.
  const fromSession = readPersistedCache<HoldQueueDayStats>(HOLD_QUEUE_STATS_CACHE_KEY)
  const sessionNorm = normalizeHoldQueueStatsPaintSeed(fromSession)
  if (sessionNorm) return sessionNorm

  // Last resort: document cookie (client after hydrate).
  return normalizeHoldQueueStatsPaintSeed(
    readPaintSeedCookie<HoldQueueDayStats>(HOLD_QUEUE_STATS_CACHE_SCOPE)
  )
}

/** Read hold-queue paint cookie from Next.js cookies().get(name)?.value. */
export function readHoldQueueStatsFromCookieRaw(
  cookieRaw: string | null | undefined
): HoldQueueDayStats | null {
  // Decode the envelope then normalize (day rollover in the owner’s zone).
  return normalizeHoldQueueStatsPaintSeed(
    readPaintSeedCookieValue<HoldQueueDayStats>(cookieRaw)
  )
}

/** Persist after a successful /api/calls/queue load (session + cookie). */
export function writeHoldQueueStatsCache(next: HoldQueueDayStats): void {
  // Owner zone so UTC servers still know which calendar day this is.
  const tz = sanitizeIanaTimezone(next.timeZone || DEFAULT_TELEMETRY_TIMEZONE)
  // Stamp the local day in that zone so tomorrow’s first paint does not reuse today.
  const dayKey = next.localDayPeriodKey ?? localDateTimePartsInZone(new Date(), tz).dateKey
  // Normalized payload we store in both places.
  const payload: HoldQueueDayStats = {
    waiting: next.waiting,
    answered: next.answered,
    press1: next.press1,
    abandoned: next.abandoned,
    avgWaitSecs: next.avgWaitSecs,
    localDayPeriodKey: dayKey,
    timeZone: tz,
  }
  // sessionStorage — same tab refresh before cookies round-trip.
  writePersistedCache(HOLD_QUEUE_STATS_CACHE_KEY, payload)
  // Tiny cookie — SSR first HTML on the next hard refresh.
  writePaintSeedCookie(HOLD_QUEUE_STATS_CACHE_SCOPE, payload)
}
