"use client"

// Shared admin console data loader — fetchLatestAdminStats without full page reload.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type {
  AdminBusinessEconomics,
  LyncrAdminDirectoryRow,
  LyncrAdminMetrics,
} from "@/lib/types"
import type { AdminSupportAlert } from "@/lib/admin-support-alerts"

/** Money window chips on Ops Home Business money. */
export type AdminMoneyPeriodUi = "all_time" | "this_month" | "last_month" | "this_year"

export type LyncrAdminDashboardData = {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  businessEconomics: AdminBusinessEconomics[]
  /** Keyed by owner user_id — only businesses with an unread support thread appear. */
  supportAlerts: Record<string, AdminSupportAlert>
  /** Selected Business money period (All time / This month / Last month / This year). */
  moneyPeriod: AdminMoneyPeriodUi
  setMoneyPeriod: (period: AdminMoneyPeriodUi) => void
  loading: boolean
  refreshing: boolean
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
}

export function useLyncrAdminDashboardData(): LyncrAdminDashboardData {
  const [metrics, setMetrics] = useState<LyncrAdminMetrics | null>(null)
  const [users, setUsers] = useState<LyncrAdminDirectoryRow[]>([])
  const [businessEconomics, setBusinessEconomics] = useState<AdminBusinessEconomics[]>([])
  const [supportAlerts, setSupportAlerts] = useState<Record<string, AdminSupportAlert>>({})
  // Default All time — so Ops sees cumulative real numbers immediately (not a fresh-month $0).
  const [moneyPeriod, setMoneyPeriodState] = useState<AdminMoneyPeriodUi>("all_time")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLatestAdminStats = useCallback(
    async (silent = false, periodOverride?: AdminMoneyPeriodUi) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)
      const period = periodOverride ?? moneyPeriod
      try {
        // Pass period so Business money matches the chip (call_logs + Stripe fees).
        const res = await fetch(`/api/admin/data?period=${encodeURIComponent(period)}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json()) as {
          error?: string
          data?: {
            metrics?: LyncrAdminMetrics
            users?: LyncrAdminDirectoryRow[]
            business_economics?: AdminBusinessEconomics[]
            support_alerts?: Record<string, AdminSupportAlert>
          }
        }
        if (!res.ok) throw new Error(json.error ?? "Failed to load admin data")
        setMetrics(json.data?.metrics ?? null)
        setUsers(json.data?.users ?? [])
        setBusinessEconomics(json.data?.business_economics ?? [])
        setSupportAlerts(json.data?.support_alerts ?? {})
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load admin data")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [moneyPeriod]
  )

  // When the user taps a period chip, update state and reload Business money for that window.
  const setMoneyPeriod = useCallback(
    (period: AdminMoneyPeriodUi) => {
      setMoneyPeriodState(period)
      void fetchLatestAdminStats(true, period)
    },
    [fetchLatestAdminStats]
  )

  useEffect(() => {
    void fetchLatestAdminStats()
    // Initial load only — period changes go through setMoneyPeriod.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    metrics,
    users,
    businessEconomics,
    supportAlerts,
    moneyPeriod,
    setMoneyPeriod,
    loading,
    refreshing,
    fetchLatestAdminStats,
  }
}
