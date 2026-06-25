// Session-scoped cache for routing telemetry — instant paint on hard refresh.

import { formatTalkDuration, formatTalkTime } from "@/lib/daily-call-telemetry"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Snapshot of call metrics shown in the routing telemetry strip. */
export type RoutingTelemetrySnapshot = {
  dailyCalls: number
  missedCalls: number
  /** Raw seconds from API — display is derived via formatTalkTime. */
  dailyTalkSeconds: number
  weeklyTalkSeconds: number
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
    ownerUserId: raw.ownerUserId,
  }
}

/** Best-effort parse legacy cached display strings like "12:05". */
function parseTalkSecondsFromDisplay(display?: string): number {
  if (!display?.trim()) return 0
  const parts = display.split(":").map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
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
    ownerUserId: null,
  }
}

/** Derived labels for pills — always computed from live seconds. */
export function telemetryTalkDisplays(snapshot: Pick<RoutingTelemetrySnapshot, "dailyTalkSeconds" | "weeklyTalkSeconds">) {
  return {
    dailyTalkDisplay: formatTalkTime(snapshot.dailyTalkSeconds),
    weeklyTalkDisplay: formatTalkDuration(snapshot.weeklyTalkSeconds),
  }
}
