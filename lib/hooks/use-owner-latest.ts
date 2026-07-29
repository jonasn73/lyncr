"use client"

// Shared Latest feed for Lines — one fetch + session cache (mobile/desktop twins share this).

import { useCallback, useEffect, useState } from "react"
import {
  isHotLatestAction,
  type LatestCustomerAction,
} from "@/lib/latest-customer-actions"
import { useDocumentVisible } from "@/lib/hooks/use-poll-budget"
import { useClientSnapshot } from "@/lib/hooks/use-client-seed"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Slow backup poll while the browser tab is hidden (Lines stays mounted). */
const LATEST_POLL_VISIBLE_MS = 30_000
const LATEST_POLL_HIDDEN_MS = 120_000

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
    const params = new URLSearchParams()
    if (organizationId && !organizationId.startsWith("legacy-")) {
      params.set("organization_id", organizationId)
    }
    // Owner’s local calendar day — server UTC must not drop evening completions.
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
    const items = sanitizeItems(json.data.latest ?? [])
    writeLatestCache(organizationId, items)
    return items
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise)
  return promise
}

const EMPTY_LATEST: LatestCustomerAction[] = []

/** Latest customer actions with instant paint from session cache. */
export function useOwnerLatest(activeOrganizationId: string | null | undefined) {
  const cachedItems = useClientSnapshot(
    () => readLatestCache(activeOrganizationId) ?? EMPTY_LATEST,
    () => EMPTY_LATEST,
    activeOrganizationId ?? "default"
  )
  const [liveItems, setLiveItems] = useState<LatestCustomerAction[] | null>(null)
  const items = liveItems ?? cachedItems
  // True only when we have nothing to show yet (cache miss).
  const [loading, setLoading] = useState(() => cachedItems.length === 0)
  // Slow the Latest poll when the browser tab is backgrounded (don't stop — Lines stays hot).
  const documentVisible = useDocumentVisible()

  // Keep loading false once a seed or live list exists (avoids empty→list blink).
  useEffect(() => {
    if (items.length > 0) setLoading(false)
  }, [items.length])

  const load = useCallback(async () => {
    try {
      const next = await fetchLatest(activeOrganizationId)
      setLiveItems(next)
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
    // Org switch — clear live override so the new org’s seed can show.
    setLiveItems(null)
    void load()
    // Poll budget: full speed in foreground; 4× slower when the tab is hidden.
    const intervalMs = documentVisible ? LATEST_POLL_VISIBLE_MS : LATEST_POLL_HIDDEN_MS
    const id = window.setInterval(() => void load(), intervalMs)
    return () => window.clearInterval(id)
  }, [load, documentVisible])

  return { items, loading, refresh: load, setItems }
}
