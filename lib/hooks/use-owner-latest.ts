"use client"

// Shared Latest feed for Lines — one fetch + session/cookie/paint-seed cache.

import { useCallback, useEffect, useState } from "react"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import { useDocumentVisible } from "@/lib/hooks/use-poll-budget"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"
import {
  EMPTY_LATEST,
  readLatestCache,
  writeLatestCache,
} from "@/lib/owner-latest-cache"

/** Slow backup poll while the browser tab is hidden (Lines stays mounted). */
const LATEST_POLL_VISIBLE_MS = 30_000
const LATEST_POLL_HIDDEN_MS = 120_000

/** In-flight dedupe so compact + desktop card mounts don’t double-hit the API. */
const inflight = new Map<string, Promise<LatestCustomerAction[]>>()

async function fetchLatest(organizationId: string | null | undefined): Promise<LatestCustomerAction[]> {
  const key =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "default"
  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const params = new URLSearchParams()
    if (organizationId && !organizationId.startsWith("legacy-")) {
      params.set("organization_id", organizationId)
    }
    params.set("timezone", resolveBrowserTimezone())
    const qs = params.toString()
    const res = await fetch(`/api/owner/latest${qs ? `?${qs}` : ""}`, {
      credentials: "include",
      cache: "no-store",
    })
    const json = (await res.json().catch(() => null)) as {
      data?: { latest?: LatestCustomerAction[] }
    } | null
    if (!res.ok || !json?.data) {
      throw new Error("latest-load-failed")
    }
    const items = Array.isArray(json.data.latest) ? json.data.latest : []
    writeLatestCache(organizationId, items)
    const cached = readLatestCache(organizationId)
    return cached.length > 0 || items.length === 0 ? cached : items
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise)
  return promise
}

/** Latest customer actions — session/cookie/SSR seed before paint, then live fetch. */
export function useOwnerLatest(activeOrganizationId: string | null | undefined) {
  const paint = useDashboardPaintSeeds()
  const paintSeed = {
    items: paint.latest,
    organizationId: paint.latestOrganizationId,
  }

  const cachedItems = useSessionSeed(
    () => readLatestCache(activeOrganizationId, paintSeed),
    EMPTY_LATEST,
    activeOrganizationId ?? "default"
  )
  const [liveItems, setLiveItems] = useState<LatestCustomerAction[] | null>(null)
  const items = liveItems ?? cachedItems
  const [loading, setLoading] = useState(
    () => readLatestCache(activeOrganizationId, paintSeed).length === 0
  )
  const documentVisible = useDocumentVisible()

  useEffect(() => {
    if (items.length > 0) setLoading(false)
  }, [items.length])

  useEffect(() => {
    if (cachedItems.length > 0) setLoading(false)
  }, [cachedItems.length])

  const load = useCallback(async () => {
    try {
      const next = await fetchLatest(activeOrganizationId)
      setLiveItems((prev) => {
        if (
          prev &&
          prev.length === next.length &&
          prev.every((row, i) => row.id === next[i]?.id)
        ) {
          return prev
        }
        return next
      })
    } catch {
      /* keep last good list */
    } finally {
      setLoading(false)
    }
  }, [activeOrganizationId])

  const setItems = useCallback(
    (next: LatestCustomerAction[] | ((prev: LatestCustomerAction[]) => LatestCustomerAction[])) => {
      setLiveItems((prev) => {
        const base = prev ?? cachedItems
        return typeof next === "function" ? next(base) : next
      })
    },
    [cachedItems]
  )

  useEffect(() => {
    void load()
    const intervalMs = documentVisible ? LATEST_POLL_VISIBLE_MS : LATEST_POLL_HIDDEN_MS
    const id = window.setInterval(() => void load(), intervalMs)
    return () => window.clearInterval(id)
  }, [load, documentVisible])

  return { items, loading, refresh: load, setItems }
}
