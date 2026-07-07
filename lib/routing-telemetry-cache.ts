// Session-scoped cache for routing telemetry — instant paint on hard refresh.

import {
  formatTalkTime,
  telemetryLocalDayPeriodKey,
  telemetryMonthPeriodKey,
  telemetryWeekPeriodKey,
} from "@/lib/daily-call-telemetry"
import { parseTalkSecondsFromDisplay } from "@/lib/telemetry-formatters"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

export { parseTalkSecondsFromDisplay } from "@/lib/telemetry-formatters"

/** Snapshot of call metrics shown in the routing telemetry strip. */
export type RoutingTelemetrySnapshot = {
  dailyCalls: number
  missedCalls: number
  /** Raw seconds from API — display is derived via formatTalkTime. */
  dailyTalkSeconds: number
  weeklyTalkSeconds: number
  monthlyTalkSeconds: number
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
  return {
    dailyCalls: raw.dailyCalls,
    missedCalls: cachedDayKey === dayKey ? raw.missedCalls : 0,
    dailyTalkSeconds: raw.dailyTalkSeconds,
    weeklyTalkSeconds: cachedWeekKey === weekKey ? raw.weeklyTalkSeconds : 0,
    monthlyTalkSeconds: cachedMonthKey === monthKey ? raw.monthlyTalkSeconds : 0,
    ownerUserId: raw.ownerUserId,
    weekPeriodKey: weekKey,
    monthPeriodKey: monthKey,
    localDayPeriodKey: dayKey,
  }
}

/** Read the last successful telemetry fetch for this org (if still fresh). */
export function readRoutingTelemetryCache(
  organizationId: string | null
): RoutingTelemetrySnapshot | undefined {
  const raw = readPersistedCache<RoutingTelemetrySnapshot & { dailyTalkDisplay?: string }>(
    routingTelemetryCacheKey(organizationId)
  )
  if (!raw) return undefined
  const parsed: RoutingTelemetrySnapshot = {
    dailyCalls: raw.dailyCalls,
    missedCalls: raw.missedCalls,
    dailyTalkSeconds:
      typeof raw.dailyTalkSeconds === "number"
        ? raw.dailyTalkSeconds
        : parseTalkSecondsFromDisplay(raw.dailyTalkDisplay),
    weeklyTalkSeconds:
      typeof raw.weeklyTalkSeconds === "number" ? raw.weeklyTalkSeconds : 0,
    monthlyTalkSeconds:
      typeof raw.monthlyTalkSeconds === "number" ? raw.monthlyTalkSeconds : 0,
    ownerUserId: raw.ownerUserId,
    weekPeriodKey: raw.weekPeriodKey,
    monthPeriodKey: raw.monthPeriodKey,
    localDayPeriodKey: raw.localDayPeriodKey,
  }
  return normalizeRoutingTelemetrySnapshot(parsed)
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
}

/** Safe defaults when no cache exists yet. */
export function emptyRoutingTelemetrySnapshot(): RoutingTelemetrySnapshot {
  return {
    dailyCalls: 0,
    missedCalls: 0,
    dailyTalkSeconds: 0,
    weeklyTalkSeconds: 0,
    monthlyTalkSeconds: 0,
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
