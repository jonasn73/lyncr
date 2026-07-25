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

const EMPTY: MissedLeadInsights = {
  totalMissedToday: 0,
  uniqueLeadsToday: 0,
  recentUnreturned: [],
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

export function useMissedLeadInsights(businessNumbers: DashboardBusinessNumber[]) {
  const [rows, setRows] = useState<MissedLeadCallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [interceptTick, setInterceptTick] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calls?limit=100", { credentials: "include", cache: "no-store" })
      if (!res.ok) throw new Error("load")
      const json = (await res.json()) as { calls?: Record<string, unknown>[] }
      const all = Array.isArray(json.calls) ? json.calls : []
      const parsed = all
        .map(normalizeApiRow)
        .filter((r): r is MissedLeadCallRow => r != null)
        .filter((row) => {
          if (businessNumbers.length === 0) return true
          return businessNumbers.some((line) =>
            businessNumbersMatch(String(row.to_number ?? ""), line.number)
          )
        })
      setRows(parsed)
    } catch {
      /* keep last good rows */
    } finally {
      setLoading(false)
    }
  }, [businessNumbers])

  useEffect(() => {
    void load()
    // Pause when the tab is hidden — avoids background /api/calls traffic.
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
