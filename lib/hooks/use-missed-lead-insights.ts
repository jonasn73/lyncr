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
import { persistedCacheKey, writePersistedCache } from "@/lib/swr/persisted-cache"

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

export function useMissedLeadInsights(businessNumbers: DashboardBusinessNumber[]) {
  const cachedRows = EMPTY_ROWS
  const [liveRows, setLiveRows] = useState<MissedLeadCallRow[] | null>(null)
  const rows = liveRows ?? cachedRows
  const [loading, setLoading] = useState(true)
  const [interceptTick, setInterceptTick] = useState(0)

  // Stable key — array identity from parents was re-firing /api/calls every render (#185 risk).
  const linesKey = useMemo(
    () =>
      businessNumbers
        .map((l) => l.number)
        .filter(Boolean)
        .sort()
        .join("|"),
    [businessNumbers]
  )

  useEffect(() => {
    if (rows.length > 0) setLoading(false)
  }, [rows.length])

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
  }, [load])

  const insights = useMemo(() => {
    void interceptTick
    if (rows.length === 0) return EMPTY
    return summarizeMissedLeadInsights(rows, {
      interceptedKeys: readInterceptedPhoneKeys(),
    })
  }, [rows, interceptTick])

  const markIntercepted = useCallback((phones: string[]) => {
    markPhonesIntercepted(phones)
    setInterceptTick((t) => t + 1)
  }, [])

  return {
    ...insights,
    loading,
    refresh: load,
    markIntercepted,
  }
}
