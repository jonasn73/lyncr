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
  type MissedLeadInsights,
} from "@/lib/missed-lead-aggregation"
import { LYNCR_ACTIVITY_REFRESH_EVENT } from "@/lib/lync-engine-bus"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  hasMissedLeadsSeed,
  MISSED_LEADS_CACHE_KEY,
  readMissedLeadsPaintSeed,
  writeMissedLeadsCache,
  type MissedLeadsPaintSeed,
  type MissedLeadsSessionCache,
} from "@/lib/missed-lead-insights-cache"
import { readPersistedCache } from "@/lib/swr/persisted-cache"

const EMPTY: MissedLeadInsights = {
  totalMissedToday: 0,
  uniqueLeadsToday: 0,
  recentUnreturned: [],
}

const EMPTY_ROWS: MissedLeadCallRow[] = []

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

function readCachedMissedLeads(): MissedLeadCallRow[] {
  const cached = readPersistedCache<MissedLeadsSessionCache>(MISSED_LEADS_CACHE_KEY)
  if (!cached || !Array.isArray(cached.rows)) return EMPTY_ROWS
  return cached.rows.length > 0 ? cached.rows : EMPTY_ROWS
}

/**
 * Summary seed so “X leads” paints in first HTML (cookie) and on hydrate (session).
 * Prefer recomputing from rows when present so intercept marks stay accurate.
 */
function readCachedMissedLeadSummary(paint?: MissedLeadsPaintSeed | null): MissedLeadInsights {
  const cached = readPersistedCache<MissedLeadsSessionCache>(MISSED_LEADS_CACHE_KEY)
  if (cached) {
    if (Array.isArray(cached.rows) && cached.rows.length > 0) {
      return summarizeMissedLeadInsights(cached.rows, {
        interceptedKeys: readInterceptedPhoneKeys(),
      })
    }
    if (typeof cached.uniqueLeadsToday === "number" && cached.uniqueLeadsToday >= 0) {
      return {
        totalMissedToday: cached.totalMissedToday ?? 0,
        uniqueLeadsToday: cached.uniqueLeadsToday,
        recentUnreturned: Array.isArray(cached.recentUnreturned) ? cached.recentUnreturned : [],
      }
    }
  }

  // SSR / hard refresh — cookie paint seed (sessionStorage is invisible to the server).
  const seeded = readMissedLeadsPaintSeed(paint)
  if (seeded) {
    return {
      totalMissedToday: seeded.totalMissedToday,
      uniqueLeadsToday: seeded.uniqueLeadsToday,
      recentUnreturned: [],
    }
  }
  return EMPTY
}

export function useMissedLeadInsights(
  businessNumbers: DashboardBusinessNumber[],
  /** When false, skip network (Lines pane hidden / inactive). */
  enabled = true
) {
  // Cookie paint seed from layout — required for hard-refresh first HTML.
  const paintSeeds = useDashboardPaintSeeds()
  const paintMissed = paintSeeds.missedLeads

  // Last-known rows before paint — useSessionSeed (not useSyncExternalStore / #185).
  const cachedRows = useSessionSeed(readCachedMissedLeads, EMPTY_ROWS, "missed-leads")
  // Seed uniqueLeadsToday from session + SSR cookie so the MISSED sublabel does not jump.
  const cachedSummary = useSessionSeed(
    () => readCachedMissedLeadSummary(paintMissed),
    EMPTY,
    // Re-read when paint seed identity changes (layout request / hydrate).
    paintMissed
      ? `missed-leads-summary:${paintMissed.uniqueLeadsToday}:${paintMissed.totalMissedToday}`
      : "missed-leads-summary"
  )
  const [liveRows, setLiveRows] = useState<MissedLeadCallRow[] | null>(null)
  const rows = liveRows ?? cachedRows
  // Ready when cookie/session already knows last-paint leads — do not wait for /api/calls.
  const hadSeed =
    hasMissedLeadsSeed(paintMissed) ||
    cachedRows.length > 0 ||
    cachedSummary.uniqueLeadsToday > 0 ||
    cachedSummary.totalMissedToday > 0
  const [loading, setLoading] = useState(() => !hadSeed)
  const [interceptTick, setInterceptTick] = useState(0)

  // One-time: mirror existing session summary into the paint cookie so the next
  // hard refresh can SSR “N leads” (users who only had sessionStorage before).
  useEffect(() => {
    const cached = readPersistedCache<MissedLeadsSessionCache>(MISSED_LEADS_CACHE_KEY)
    if (!cached || typeof cached.uniqueLeadsToday !== "number") return
    writeMissedLeadsCache({
      rows: Array.isArray(cached.rows) ? cached.rows : [],
      recentUnreturned: Array.isArray(cached.recentUnreturned) ? cached.recentUnreturned : [],
      uniqueLeadsToday: cached.uniqueLeadsToday,
      totalMissedToday: cached.totalMissedToday ?? 0,
      localDayPeriodKey: cached.localDayPeriodKey,
    })
  }, [])

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

  // Summary-only seed (cookie or session) means we can show “X leads” immediately.
  useEffect(() => {
    if (
      hadSeed ||
      cachedSummary.uniqueLeadsToday > 0 ||
      cachedSummary.totalMissedToday > 0
    ) {
      setLoading(false)
    }
  }, [hadSeed, cachedSummary.uniqueLeadsToday, cachedSummary.totalMissedToday])

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
      writeMissedLeadsCache({
        rows: parsed,
        recentUnreturned: summary.recentUnreturned,
        uniqueLeadsToday: summary.uniqueLeadsToday,
        totalMissedToday: summary.totalMissedToday,
      })
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

  // Seeded counts are safe to show immediately — never gate the ticker on fetch `loading`.
  const ready =
    hadSeed ||
    !loading ||
    rows.length > 0 ||
    cachedSummary.uniqueLeadsToday > 0 ||
    cachedSummary.totalMissedToday > 0

  return {
    ...insights,
    loading,
    /** True once cookie/session seed or network settled — safe to show “X leads” sublabel. */
    ready,
    refresh: load,
    markIntercepted,
  }
}
