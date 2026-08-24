"use client"

// Saved shop / home-base coordinates — the baseline intake travel distance is measured
// from when there is no live GPS fix.

import { useEffect, useState } from "react"

export type ShopOriginPoint = { lat: number; lng: number }

/** Module-level cache: several surfaces mount this at once and the value rarely changes. */
let cached: ShopOriginPoint | null | undefined
let inFlight: Promise<ShopOriginPoint | null> | null = null

function loadShopOrigin(): Promise<ShopOriginPoint | null> {
  if (cached !== undefined) return Promise.resolve(cached)
  if (inFlight) return inFlight
  inFlight = fetch("/api/settings/shop-address", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const data = json?.data
      const lat = Number(data?.lat)
      const lng = Number(data?.lng)
      cached = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
      return cached
    })
    .catch(() => {
      // Unset or unreachable is a normal state — callers fall back to the metro centroid.
      cached = null
      return null
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Drop the cache so a freshly saved address is picked up without a reload. */
export function clearShopOriginCache() {
  cached = undefined
  inFlight = null
}

export function useShopOrigin(): ShopOriginPoint | null {
  const [origin, setOrigin] = useState<ShopOriginPoint | null>(cached ?? null)

  useEffect(() => {
    let cancelled = false
    void loadShopOrigin().then((next) => {
      if (!cancelled) setOrigin(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return origin
}
