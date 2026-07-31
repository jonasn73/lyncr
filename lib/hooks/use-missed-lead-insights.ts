"use client"

// Fetch today's call logs and derive unique missed leads + recent unreturned prospects.

import { useCallback, useEffect, useMemo, useState } from "react"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import {
  markPhonesIntercepted,
  readInterceptedPhoneKeys,
  summarizeMissedLeadInsights,
  type MissedLeadCallRow,
  type MissedLeadHotProspect,
  type MissedLeadInsights,
} from "@/lib/missed-lead-aggregation"
import { LYNCR_ACTIVITY_REFRESH_EVENT } from "@/lib/lync-engine-bus"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

const EMPTY: MissedLeadInsights = {
  totalMissedToday: 0,
  uniqueLeadsToday: 0,
  recentUnreturned: [],
}

/** Keep the unreturned banner from popping in after /api/calls on hard refresh. */
const MISSED_LEADS_CACHE_KEY = persistedCacheKey("missed-lead-insights", "banner")

type MissedLeadsCache = {
  rows: MissedLeadCallRow[]
  recentUnreturned: MissedLeadHotProspect[]
  uniqueLeadsToday: number
  totalMissedToday: number
}

function normalizeApiRow(raw: Record<string, unknown>): MissedLeadCallRow | null {
  const id = String(raw.id ?? "").trim()
  const from = String(raw.from_number ?? "").trim()
  const created = String(raw.created_at ?? "").trim()
  if (!id || !from || !created) return null
  return {
    id,
    from_number: from,
    to_number: raw.to_number != null ? String(raw.to_number) : null,
    created_at: created,
    call_type: raw.call_type != null ? String(raw.call_type) : null,
    status: raw.status != null ? String(raw.status) : null,
    answered_at: raw.answered_at != null ? String(raw.answered_at) : null,
    ended_at: raw.ended_at != null ? String(raw.ended_at) : null,
    routed_to_name: raw.routed_to_name != null ? String(raw.routed_to_name) : null,
  }
}

const EMPTY_ROWS: MissedLeadCallRow[] = []

function readCachedMissedLeads(): MissedLeadCallRow[] {
  const cached = readPersistedCache<MissedLeadsCache>(MISSED_LEADS_CACHE_KEY)
  if (!cached || !Array.isArray(cached.rows)) return EMPTY_ROWS
  return cached.rows.length > 0 ? cached.rows : EMPTY_ROWS
}

/** Summary seed so “X leads” can paint before /api/calls returns (stops 0→N ticker jump). */
function readCachedMissedLeadSummary(): MissedLeadInsights {
  const cached = readPersistedCache<MissedLeadsCache>(MISSED_LEADS_CACHE_KEY)
  if (!cached) return EMPTY
  // Prefer recomputing from rows when we have them (respects intercept marks).
  if (Array.isArray(cached.rows) && cached.rows.length > 0) {
    return summarizeMissedLeadInsights(cached.rows, {
      interceptedKeys: readInterceptedPhoneKeys(),
    })
  }
  // Summary-only fallback from last successful write.
  if (typeof cached.uniqueLeadsToday === "number" && cached.uniqueLeadsToday >= 0) {
    return {
      totalMissedToday: cached.totalMissedToday ?? 0,
      uniqueLeadsToday: cached.uniqueLeadsToday,
      recentUnreturned: Array.isArray(cached.recentUnreturned) ? cached.recentUnreturned : [],
    }
  }
  return EMPTY
}

export function useMissedLeadInsights(
  businessNumbers: DashboardBusinessNumber[],
  /** When false, skip network (Lines pane hidden / inactive). */
  enabled = true
) {
  // Last-known rows before paint — useSessionSeed (not useSyncExternalStore / #185).
  const cachedRows = useSessionSeed(readCachedMissedLeads, EMPTY_ROWS, "missed-leads")
  // Seed uniqueLeadsToday independently so the MISSED ticker sublabel does not jump 0→N.
  const cachedSummary = useSessionSeed(readCachedMissedLeadSummary, EMPTY, "missed-leads-summary")
  const [liveRows, setLiveRows] = useState<MissedLeadCallRow[] | null>(null)
  const rows = liveRows ?? cachedRows
  // Ready when we already know last-paint leads (even 0) — hide sublabel only while truly unknown.
  const hadSeed =
    cachedRows.length > 0 ||
    cachedSummary.uniqueLeadsToday > 0 ||
    cachedSummary.totalMissedToday > 0
  const [loading, setLoading] = useState(() => !hadSeed)
  const [interceptTick, setInterceptTick] = useState(0)

  // Stable string key — do not depend on businessNumbers array identity (#185 risk).
  const linesKey = businessNumbers
    .map((l) => l.number)
    .filter(Boolean)
    .sort()
    .join("|")

  useEffect(() => {
    if (rows.length > 0) setLoading(false)
  }, [rows.length])

  // When seed hydrates after mount, drop the spinner without waiting for fetch.
  useEffect(() => {
    if (cachedRows.length > 0) setLoading(false)
  }, [cachedRows.length])

  // Summary-only seed (uniqueLeadsToday) also means we can show “X leads” immediately.
  useEffect(() => {
    if (cachedSummary.uniqueLeadsToday > 0 || cachedSummary.totalMissedToday > 0) {
      setLoading(false)
    }
  }, [cachedSummary.uniqueLeadsToday, cachedSummary.totalMissedToday])

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calls?limit=100", { credentials: "include", cache: "no-store" })
      if (!res.ok) throw new Error("load")
      const json = (await res.json()) as { calls?: Record<string, unknown>[] }
      const all = Array.isArray(json.calls) ? json.calls : []
      const lineSet = new Set(linesKey ? linesKey.split("|") : [])
      const parsed = all
        .map(normalizeApiRow)
        .filter((r): r is MissedLeadCallRow => r != null)
        .filter((row) => {
          if (lineSet.size === 0) return true
          const to = String(row.to_number ?? "")
          return [...lineSet].some((n) => businessNumbersMatch(to, n))
        })
      setLiveRows((prev) => {
        if (
          prev &&
          prev.length === parsed.length &&
          prev.every((row, i) => row.id === parsed[i]?.id)
        ) {
          return prev
        }
        return parsed
      })
      const summary = summarizeMissedLeadInsights(parsed, {
        interceptedKeys: readInterceptedPhoneKeys(),
      })
      writePersistedCache(MISSED_LEADS_CACHE_KEY, {
        rows: parsed,
        recentUnreturned: summary.recentUnreturned,
        uniqueLeadsToday: summary.uniqueLeadsToday,
        totalMissedToday: summary.totalMissedToday,
      } satisfies MissedLeadsCache)
    } catch {
      /* keep last good rows */
    } finally {
      setLoading(false)
    }
  }, [linesKey])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void load()
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      void load()
    }, 90_000)
    const onRefresh = () => void load()
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    window.addEventListener(LYNCR_ACTIVITY_REFRESH_EVENT, onRefresh)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(LYNCR_ACTIVITY_REFRESH_EVENT, onRefresh)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load, enabled])

  const insights = useMemo(() => {
    void interceptTick
    // Live / seeded rows win; otherwise keep last summary so “3 leads” does not flash away.
    if (rows.length > 0) {
      return summarizeMissedLeadInsights(rows, {
        interceptedKeys: readInterceptedPhoneKeys(),
      })
    }
    return cachedSummary
  }, [rows, interceptTick, cachedSummary])

  const markIntercepted = useCallback((phones: string[]) => {
    markPhonesIntercepted(phones)
    setInterceptTick((t) => t + 1)
  }, [])

  return {
    ...insights,
    loading,
    /** True once session seed or network settled — safe to show “X leads” sublabel. */
    ready:
      !loading ||
      rows.length > 0 ||
      cachedSummary.uniqueLeadsToday > 0 ||
      cachedSummary.totalMissedToday > 0,
    refresh: load,
    markIntercepted,
  }
}
