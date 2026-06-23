// Session-scoped cache for routing telemetry — instant paint on hard refresh.

import { formatTalkDuration } from "@/lib/daily-call-telemetry"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Snapshot of call metrics shown in the routing telemetry strip. */
export type RoutingTelemetrySnapshot = {
  dailyCalls: number
  missedCalls: number
  dailyTalkDisplay: string
  weeklyTalkDisplay: string
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
  return readPersistedCache<RoutingTelemetrySnapshot>(routingTelemetryCacheKey(organizationId))
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
    dailyTalkDisplay: formatTalkDuration(0),
    weeklyTalkDisplay: formatTalkDuration(0),
    ownerUserId: null,
  }
}
