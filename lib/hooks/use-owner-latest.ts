"use client"

// Shared Latest feed for Lines — one fetch + session cache (mobile/desktop twins share this).

import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import {
  isHotLatestAction,
  type LatestCustomerAction,
} from "@/lib/latest-customer-actions"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

type LatestCache = { items: LatestCustomerAction[] }

function cacheKey(organizationId: string | null | undefined): string {
  const id =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "default"
  return persistedCacheKey("owner-latest", id)
}

function sanitizeItems(items: unknown): LatestCustomerAction[] {
  if (!Array.isArray(items)) return []
  // Drop legacy outbound “sent” cards from older session cache.
  return items.filter(isHotLatestAction)
}

function readLatestCache(organizationId: string | null | undefined): LatestCustomerAction[] | null {
  const cached = readPersistedCache<LatestCache>(cacheKey(organizationId))
  if (!cached || !Array.isArray(cached.items)) return null
  return sanitizeItems(cached.items)
}

function writeLatestCache(
  organizationId: string | null | undefined,
  items: LatestCustomerAction[]
) {
  writePersistedCache(cacheKey(organizationId), {
    items: sanitizeItems(items),
  } satisfies LatestCache)
}

/** In-flight dedupe so compact + desktop card mounts don’t double-hit the API. */
const inflight = new Map<string, Promise<LatestCustomerAction[]>>()

async function fetchLatest(organizationId: string | null | undefined): Promise<LatestCustomerAction[]> {
  const key = cacheKey(organizationId)
  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const orgQs =
      organizationId && !organizationId.startsWith("legacy-")
        ? `?organization_id=${encodeURIComponent(organizationId)}`
        : ""
    const res = await fetch(`/api/owner/latest${orgQs}`, {
      credentials: "include",
      cache: "no-store",
    })
    const json = (await res.json().catch(() => null)) as {
      data?: { latest?: LatestCustomerAction[] }
    } | null
    if (!res.ok || !json?.data) {
      throw new Error("latest-load-failed")
    }
    const items = sanitizeItems(json.data.latest ?? [])
    writeLatestCache(organizationId, items)
    return items
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise)
  return promise
}

/** Latest customer actions with instant paint from session cache. */
export function useOwnerLatest(activeOrganizationId: string | null | undefined) {
  const [items, setItems] = useState<LatestCustomerAction[]>([])
  // True only when we have nothing to show yet (cache miss).
  const [loading, setLoading] = useState(true)

  // Restore last list before paint — stops “Loading…” flash on hard refresh.
  useLayoutEffect(() => {
    const cached = readLatestCache(activeOrganizationId)
    if (cached) {
      setItems(cached)
      setLoading(false)
    }
  }, [activeOrganizationId])

  const load = useCallback(async () => {
    try {
      const next = await fetchLatest(activeOrganizationId)
      setItems(next)
    } catch {
      /* keep last good list */
    } finally {
      setLoading(false)
    }
  }, [activeOrganizationId])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  return { items, loading, refresh: load, setItems }
}
