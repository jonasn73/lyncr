/** Session cache for line Live & Connected — avoids Activating… flash on hard refresh. */

import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import { readDashboardBootstrapCache } from "@/lib/dashboard-bootstrap-cache"
import { readLinesChromeCache, writeLinesChromeCache } from "@/lib/lines-chrome-cache"

export type ActivationLineCache = {
  subscriptionActive: boolean
  lineCarrierLive: boolean
}

const ACTIVATION_CACHE_KEY = persistedCacheKey("activation-line", "status")

export function readActivationLineCache(): ActivationLineCache | null {
  const cached = readPersistedCache<ActivationLineCache>(ACTIVATION_CACHE_KEY)
  if (!cached || typeof cached.lineCarrierLive !== "boolean") return null
  return {
    subscriptionActive: cached.subscriptionActive === true,
    lineCarrierLive: cached.lineCarrierLive === true,
  }
}

export function writeActivationLineCache(next: ActivationLineCache): void {
  writePersistedCache(ACTIVATION_CACHE_KEY, next)
  // Keep lines chrome cookie in sync so SSR can paint Live & Connected.
  const chrome = readLinesChromeCache()
  if (chrome?.lines.length) {
    writeLinesChromeCache({
      ...chrome,
      lineCarrierLive: next.lineCarrierLive,
      subscriptionActive: next.subscriptionActive,
    })
  }
}

/**
 * Best-effort Live status for first paint: explicit seed → session cache → bootstrap lines.
 * Safe to call during useState lazy init (returns false on the server).
 */
export function resolveInitialLineCarrierLive(seedLive?: boolean): boolean {
  if (seedLive === true) return true
  if (typeof window === "undefined") return Boolean(seedLive)
  const cached = readActivationLineCache()
  if (cached?.lineCarrierLive) return true
  const chrome = readLinesChromeCache()
  if (chrome?.lineCarrierLive) return true
  const boot = readDashboardBootstrapCache()
  if (boot?.phoneLines?.some((line) => line.status === "active")) return true
  return Boolean(seedLive)
}

export function resolveInitialSubscriptionActive(seedActive?: boolean): boolean {
  if (seedActive === true) return true
  if (typeof window === "undefined") return Boolean(seedActive)
  const cached = readActivationLineCache()
  if (cached?.subscriptionActive || cached?.lineCarrierLive) return true
  const chrome = readLinesChromeCache()
  if (chrome?.subscriptionActive || chrome?.lineCarrierLive) return true
  const boot = readDashboardBootstrapCache()
  if (boot?.phoneLines?.some((line) => line.status === "active")) return true
  return Boolean(seedActive)
}
