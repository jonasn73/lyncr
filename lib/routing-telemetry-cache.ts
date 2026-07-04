// Session-scoped cache for routing telemetry — instant paint on hard refresh.

import { formatTalkDuration, formatTalkTime } from "@/lib/daily-call-telemetry"
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
}

/** Build the sessionStorage key for a workspace org. */
export function routingTelemetryCacheKey(organizationId: string | null): string {
  return persistedCacheKey("routing-telemetry", organizationId ?? "default")
}

/** Read the last successful telemetry fetch for this org (if still fresh). */
export function readRoutingTelemetryCache(
  organizationId: string | null
): RoutingTelemetrySnapshot | undefined {
  const raw = readPersistedCache<RoutingTelemetrySnapshot & { dailyTalkDisplay?: string }>(
    routingTelemetryCacheKey(organizationId)
  )
  if (!raw) return undefined
  return {
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
  }
}

/** Persist telemetry after a successful API response. */
export function writeRoutingTelemetryCache(
  organizationId: string | null,
  snapshot: RoutingTelemetrySnapshot
): void {
  writePersistedCache(routingTelemetryCacheKey(organizationId), snapshot)
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
    weeklyTalkDisplay: formatTalkDuration(snapshot.weeklyTalkSeconds),
    monthlyTalkDisplay: formatTalkDuration(snapshot.monthlyTalkSeconds),
  }
}
