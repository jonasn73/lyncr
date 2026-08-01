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
  hasLatestSeed,
  readLatestCache,
  writeLatestCache,
} from "@/lib/owner-latest-cache"
import {
  excludeReadRepliesFromLatest,
  LATEST_SEEN_CHANGED_EVENT,
} from "@/lib/latest-seen"

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
    const raw = Array.isArray(json.data.latest) ? json.data.latest : []
    // Hide replies the owner already opened (localStorage seen stamps).
    const items = excludeReadRepliesFromLatest(raw)
    writeLatestCache(organizationId, items)
    // Prefer sanitized cache so hot-only filter matches session/cookie seeds.
    return readLatestCache(organizationId)
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise)
  return promise
}

/** Latest customer actions — session/cookie/SSR seed before paint, then live fetch. */
export function useOwnerLatest(activeOrganizationId: string | null | undefined) {
  const paint = useDashboardPaintSeeds()
  // `latest !== null` means the paint cookie existed (even `[]` = confirmed empty).
  const paintHasSeed = paint.latest != null
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
  // Never start in “Loading…” when we already know empty or have cached rows (stops spinner flash).
  const [loading, setLoading] = useState(
    () =>
      !paintHasSeed &&
      !hasLatestSeed(activeOrganizationId, paintSeed) &&
      readLatestCache(activeOrganizationId, paintSeed).length === 0
  )
  const documentVisible = useDocumentVisible()

  useEffect(() => {
    if (items.length > 0) setLoading(false)
  }, [items.length])

  useEffect(() => {
    if (cachedItems.length > 0 || paintHasSeed) setLoading(false)
  }, [cachedItems.length, paintHasSeed])

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
        const resolved = typeof next === "function" ? next(base) : next
        const filtered = excludeReadRepliesFromLatest(resolved)
        writeLatestCache(activeOrganizationId, filtered)
        return filtered
      })
    },
    [activeOrganizationId, cachedItems]
  )

  // When Messages / Latest marks a phone seen, drop that reply row immediately.
  useEffect(() => {
    const onSeen = () => {
      setLiveItems((prev) => {
        const base = prev ?? cachedItems
        const filtered = excludeReadRepliesFromLatest(base)
        if (filtered.length === base.length) return prev
        writeLatestCache(activeOrganizationId, filtered)
        return filtered
      })
    }
    window.addEventListener(LATEST_SEEN_CHANGED_EVENT, onSeen)
    return () => window.removeEventListener(LATEST_SEEN_CHANGED_EVENT, onSeen)
  }, [activeOrganizationId, cachedItems])

  useEffect(() => {
    void load()
    const intervalMs = documentVisible ? LATEST_POLL_VISIBLE_MS : LATEST_POLL_HIDDEN_MS
    const id = window.setInterval(() => void load(), intervalMs)
    return () => window.clearInterval(id)
  }, [load, documentVisible])

  return { items, loading, refresh: load, setItems }
}
