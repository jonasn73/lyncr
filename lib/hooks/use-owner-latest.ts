"use client"

// Shared Latest feed for Lines — one fetch + session/cookie/paint-seed cache.

import { useCallback, useEffect, useRef, useState } from "react"
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
import { refreshHeaderMoney } from "@/lib/settings-modals-events"
import { formatHeaderMoneyCents } from "@/lib/header-money-cache"
import { useToast } from "@/hooks/use-toast"

/** Slow backup poll while the browser tab is hidden (Lines stays mounted). */
const LATEST_POLL_VISIBLE_MS = 30_000
const LATEST_POLL_HIDDEN_MS = 120_000

/** Remember which payment ids we already toasted this browser session. */
const SEEN_PAID_TOAST_KEY = "lyncr-latest-paid-toasted"
/** Remember which book-form lead ids we already toasted this browser session. */
const SEEN_BOOK_TOAST_KEY = "lyncr-latest-book-toasted"

function readSeenIdSet(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === "string"))
  } catch {
    return new Set()
  }
}

function writeSeenIdSet(storageKey: string, ids: Set<string>): void {
  if (typeof window === "undefined") return
  try {
    const list = [...ids].slice(-40)
    sessionStorage.setItem(storageKey, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
}

function readSeenPaidToastIds(): Set<string> {
  return readSeenIdSet(SEEN_PAID_TOAST_KEY)
}

function writeSeenPaidToastIds(ids: Set<string>): void {
  writeSeenIdSet(SEEN_PAID_TOAST_KEY, ids)
}

function readSeenBookToastIds(): Set<string> {
  return readSeenIdSet(SEEN_BOOK_TOAST_KEY)
}

function writeSeenBookToastIds(ids: Set<string>): void {
  writeSeenIdSet(SEEN_BOOK_TOAST_KEY, ids)
}

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
    // Hide replies / book forms / payments the owner already opened (localStorage).
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
  const { toast } = useToast()
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
  // First successful fetch only seeds “seen” ids — later fetches can toast new payments / book forms.
  const primedPaidToastRef = useRef(false)
  const primedBookToastRef = useRef(false)

  useEffect(() => {
    if (items.length > 0) setLoading(false)
  }, [items.length])

  useEffect(() => {
    if (cachedItems.length > 0 || paintHasSeed) setLoading(false)
  }, [cachedItems.length, paintHasSeed])

  const notifyNewPayments = useCallback(
    (next: LatestCustomerAction[]) => {
      const paid = next.filter((row) => row.event === "customer_paid")
      if (paid.length === 0) {
        primedPaidToastRef.current = true
        return
      }
      const seen = readSeenPaidToastIds()
      if (!primedPaidToastRef.current) {
        // First load: mark current payments as already known (no toast spam on refresh).
        for (const row of paid) seen.add(row.id)
        writeSeenPaidToastIds(seen)
        primedPaidToastRef.current = true
        return
      }
      const fresh = paid.filter((row) => !seen.has(row.id))
      if (fresh.length === 0) return
      for (const row of fresh) seen.add(row.id)
      writeSeenPaidToastIds(seen)
      // Brief in-app toast when a new settle shows up on the next Latest poll.
      const newest = fresh[0]!
      const dollars =
        newest.paidAmountCents != null
          ? formatHeaderMoneyCents(newest.paidAmountCents)
          : ""
      toast({
        title: dollars ? `Payment received · ${dollars}` : "Payment received",
        description: newest.customerName
          ? `${newest.customerName} paid — see Latest.`
          : "A customer paid — see Latest.",
      })
      // Nudge the header wallet so Pending / Available catch up.
      refreshHeaderMoney()
    },
    [toast]
  )

  const notifyNewBookForms = useCallback(
    (next: LatestCustomerAction[]) => {
      const books = next.filter((row) => row.event === "book_form")
      if (books.length === 0) {
        primedBookToastRef.current = true
        return
      }
      const seen = readSeenBookToastIds()
      if (!primedBookToastRef.current) {
        for (const row of books) seen.add(row.id)
        writeSeenBookToastIds(seen)
        primedBookToastRef.current = true
        return
      }
      const fresh = books.filter((row) => !seen.has(row.id))
      if (fresh.length === 0) return
      for (const row of fresh) seen.add(row.id)
      writeSeenBookToastIds(seen)
      const newest = fresh[0]!
      toast({
        title: newest.headline || "Customer submitted book form",
        description: newest.customerName
          ? `${newest.customerName} — open Latest to book.`
          : "Open Latest to review and book.",
      })
    },
    [toast]
  )

  const load = useCallback(async () => {
    try {
      const next = await fetchLatest(activeOrganizationId)
      notifyNewPayments(next)
      notifyNewBookForms(next)
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
  }, [activeOrganizationId, notifyNewPayments, notifyNewBookForms])

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

  // When Messages / Latest marks an item seen, drop that row immediately.
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
