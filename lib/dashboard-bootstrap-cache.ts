import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

const CACHE_SCOPE = "dashboard-main-bootstrap"
const CACHE_ID = "default"

export function dashboardBootstrapCacheKey(): string {
  return persistedCacheKey(CACHE_SCOPE, CACHE_ID)
}

/** Last successful routing bootstrap — instant paint on hard refresh (stale-while-revalidate). */
export function readDashboardBootstrapCache(): DashboardMainBootstrap | undefined {
  return readPersistedCache<DashboardMainBootstrap>(dashboardBootstrapCacheKey())
}

export function writeDashboardBootstrapCache(data: DashboardMainBootstrap): void {
  writePersistedCache(dashboardBootstrapCacheKey(), data)
}
