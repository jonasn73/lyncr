// Session-scoped cache for routing telemetry — instant paint on hard refresh.

import {
  formatTalkTime,
  telemetryLocalDayPeriodKey,
  telemetryMonthPeriodKey,
  telemetryWeekPeriodKey,
} from "@/lib/daily-call-telemetry"
import {
  paintSeedCookieName,
  readPaintSeedCookie,
  readPaintSeedCookieValue,
  writePaintSeedCookie,
} from "@/lib/paint-seed-cookie"
import { parseTalkSecondsFromDisplay } from "@/lib/telemetry-formatters"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export { parseTalkSecondsFromDisplay } from "@/lib/telemetry-formatters"

/** Cookie scope — compact snapshot for SSR hard refresh. */
export const ROUTING_TELEMETRY_COOKIE_SCOPE = "routing-telemetry"
export const ROUTING_TELEMETRY_COOKIE = paintSeedCookieName(ROUTING_TELEMETRY_COOKIE_SCOPE)

type TelemetryPaintCookie = {
  organizationId: string | null
  snapshot: RoutingTelemetrySnapshot
}

/** Optional SSR paint seed (from DashboardPaintSeedsProvider). */
export type RoutingTelemetryPaintSeed = {
  snapshot: RoutingTelemetrySnapshot | null
  organizationId: string | null
}

/** Snapshot of call metrics shown in the routing telemetry strip. */
export type RoutingTelemetrySnapshot = {
  dailyCalls: number
  missedCalls: number
  /** Busy menu / Hold / Press 1 legs today (handled — not classic misses). */
  holdPathCalls?: number
  /** Raw seconds from API — display is derived via formatTalkTime. */
  dailyTalkSeconds: number
  weeklyTalkSeconds: number
  monthlyTalkSeconds: number
  /** Real booked jobs ÷ unique callers today (0–100). */
  bookingRatePercent: number
  /** BOOKED jobs created or scheduled today (numerator for Booking %). */
  bookedJobsCount?: number
  /** Unique inbound callers today (denominator for Booking %). */
  uniqueCallersCount?: number
  /** Average minutes from call end → dispatched job today (null when no samples). */
  avgDispatchSpeedMinutes: number | null
  /**
   * Rescue $ today: salvage_pending quotes + booked-after-hold/press-1 quotes (cents).
   */
  rescueRevenueCents: number
  ownerUserId: string | null
  /** When the snapshot was taken — used to drop stale week/month/day counters. */
  weekPeriodKey?: string
  monthPeriodKey?: string
  localDayPeriodKey?: string
}

/** Build the sessionStorage key for a workspace org. */
export function routingTelemetryCacheKey(organizationId: string | null): string {
  return persistedCacheKey("routing-telemetry", organizationId ?? "default")
}

/** Drop period-bound counters when the cached snapshot is from a prior day/week/month. */
export function normalizeRoutingTelemetrySnapshot(
  raw: RoutingTelemetrySnapshot,
  now: Date = new Date()
): RoutingTelemetrySnapshot {
  const weekKey = telemetryWeekPeriodKey(now)
  const monthKey = telemetryMonthPeriodKey(now)
  const dayKey = telemetryLocalDayPeriodKey(now)
  const cachedWeekKey = raw.weekPeriodKey ?? weekKey
  const cachedMonthKey = raw.monthPeriodKey ?? monthKey
  const cachedDayKey = raw.localDayPeriodKey ?? dayKey
  const sameDay = cachedDayKey === dayKey
  return {
    dailyCalls: sameDay ? raw.dailyCalls : 0,
    missedCalls: sameDay ? raw.missedCalls : 0,
    holdPathCalls: sameDay ? raw.holdPathCalls ?? 0 : 0,
    dailyTalkSeconds: sameDay ? raw.dailyTalkSeconds : 0,
    weeklyTalkSeconds: cachedWeekKey === weekKey ? raw.weeklyTalkSeconds : 0,
    monthlyTalkSeconds: cachedMonthKey === monthKey ? raw.monthlyTalkSeconds : 0,
    bookingRatePercent: sameDay ? raw.bookingRatePercent ?? 0 : 0,
    bookedJobsCount: sameDay ? raw.bookedJobsCount ?? 0 : 0,
    uniqueCallersCount: sameDay ? raw.uniqueCallersCount ?? 0 : 0,
    avgDispatchSpeedMinutes: sameDay ? raw.avgDispatchSpeedMinutes ?? null : null,
    rescueRevenueCents: sameDay ? raw.rescueRevenueCents ?? 0 : 0,
    ownerUserId: raw.ownerUserId,
    weekPeriodKey: weekKey,
    monthPeriodKey: monthKey,
    localDayPeriodKey: dayKey,
  }
}

function parseTelemetryRaw(
  raw: (RoutingTelemetrySnapshot & { dailyTalkDisplay?: string }) | undefined
): RoutingTelemetrySnapshot | undefined {
  if (!raw) return undefined
  const parsed: RoutingTelemetrySnapshot = {
    dailyCalls: raw.dailyCalls,
    missedCalls: raw.missedCalls,
    holdPathCalls: typeof raw.holdPathCalls === "number" ? raw.holdPathCalls : 0,
    dailyTalkSeconds:
      typeof raw.dailyTalkSeconds === "number"
        ? raw.dailyTalkSeconds
        : parseTalkSecondsFromDisplay(raw.dailyTalkDisplay),
    weeklyTalkSeconds:
      typeof raw.weeklyTalkSeconds === "number" ? raw.weeklyTalkSeconds : 0,
    monthlyTalkSeconds:
      typeof raw.monthlyTalkSeconds === "number" ? raw.monthlyTalkSeconds : 0,
    bookingRatePercent:
      typeof raw.bookingRatePercent === "number" ? raw.bookingRatePercent : 0,
    bookedJobsCount: typeof raw.bookedJobsCount === "number" ? raw.bookedJobsCount : 0,
    uniqueCallersCount: typeof raw.uniqueCallersCount === "number" ? raw.uniqueCallersCount : 0,
    avgDispatchSpeedMinutes:
      typeof raw.avgDispatchSpeedMinutes === "number" ? raw.avgDispatchSpeedMinutes : null,
    rescueRevenueCents:
      typeof raw.rescueRevenueCents === "number" ? raw.rescueRevenueCents : 0,
    ownerUserId: raw.ownerUserId,
    weekPeriodKey: raw.weekPeriodKey,
    monthPeriodKey: raw.monthPeriodKey,
    localDayPeriodKey: raw.localDayPeriodKey,
  }
  return normalizeRoutingTelemetrySnapshot(parsed)
}

function orgKey(organizationId: string | null | undefined): string {
  return organizationId && !organizationId.startsWith("legacy-") ? organizationId : "default"
}

/**
 * Read the last successful telemetry fetch for this org (if still fresh).
 * Pass `paint` from useDashboardPaintSeeds() so SSR can seed without sessionStorage.
 * Prefer paint over session when both exist (React #418).
 */
export function readRoutingTelemetryCache(
  organizationId: string | null,
  cookieRaw?: string | null,
  paint?: RoutingTelemetryPaintSeed | null
): RoutingTelemetrySnapshot | undefined {
  const want = orgKey(organizationId)

  // Warm paint seed first — SSR HTML used this; hydrate must match.
  if (paint?.snapshot && orgKey(paint.organizationId) === want) {
    return normalizeRoutingTelemetrySnapshot(paint.snapshot)
  }

  const fromSession = parseTelemetryRaw(
    readPersistedCache<RoutingTelemetrySnapshot & { dailyTalkDisplay?: string }>(
      routingTelemetryCacheKey(organizationId)
    )
  )
  if (fromSession) return fromSession

  const fromCookie =
    cookieRaw !== undefined
      ? readPaintSeedCookieValue<TelemetryPaintCookie>(cookieRaw)
      : readPaintSeedCookie<TelemetryPaintCookie>(ROUTING_TELEMETRY_COOKIE_SCOPE)
  if (fromCookie?.snapshot && orgKey(fromCookie.organizationId) === want) {
    return normalizeRoutingTelemetrySnapshot(fromCookie.snapshot)
  }
  return undefined
}

/** Persist telemetry after a successful API response. */
export function writeRoutingTelemetryCache(
  organizationId: string | null,
  snapshot: RoutingTelemetrySnapshot
): void {
  const stamped: RoutingTelemetrySnapshot = {
    ...snapshot,
    weekPeriodKey: snapshot.weekPeriodKey ?? telemetryWeekPeriodKey(),
    monthPeriodKey: snapshot.monthPeriodKey ?? telemetryMonthPeriodKey(),
    localDayPeriodKey: snapshot.localDayPeriodKey ?? telemetryLocalDayPeriodKey(),
  }
  writePersistedCache(routingTelemetryCacheKey(organizationId), stamped)
  writePaintSeedCookie(ROUTING_TELEMETRY_COOKIE_SCOPE, {
    organizationId: organizationId && !organizationId.startsWith("legacy-") ? organizationId : null,
    snapshot: stamped,
  } satisfies TelemetryPaintCookie)
}

/** Safe defaults when no cache exists yet. */
export function emptyRoutingTelemetrySnapshot(): RoutingTelemetrySnapshot {
  return {
    dailyCalls: 0,
    missedCalls: 0,
    holdPathCalls: 0,
    dailyTalkSeconds: 0,
    weeklyTalkSeconds: 0,
    monthlyTalkSeconds: 0,
    bookingRatePercent: 0,
    bookedJobsCount: 0,
    uniqueCallersCount: 0,
    avgDispatchSpeedMinutes: null,
    rescueRevenueCents: 0,
    ownerUserId: null,
  }
}

/** Derived labels for pills — always computed from live seconds. */
export function telemetryTalkDisplays(
  snapshot: Pick<RoutingTelemetrySnapshot, "dailyTalkSeconds" | "weeklyTalkSeconds" | "monthlyTalkSeconds">
) {
  return {
    dailyTalkDisplay: formatTalkTime(snapshot.dailyTalkSeconds),
    weeklyTalkDisplay: formatTalkTime(snapshot.weeklyTalkSeconds),
    monthlyTalkDisplay: formatTalkTime(snapshot.monthlyTalkSeconds),
  }
}
