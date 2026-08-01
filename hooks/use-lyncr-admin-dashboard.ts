"use client"

// Shared admin console data loader — fetchLatestAdminStats without full page reload.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type {
  AdminBusinessEconomics,
  LyncrAdminDirectoryRow,
  LyncrAdminMetrics,
} from "@/lib/types"

/** Money window chips on Ops Home Business money. */
export type AdminMoneyPeriodUi = "this_month" | "last_month" | "last_30_days"

export type LyncrAdminDashboardData = {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  businessEconomics: AdminBusinessEconomics[]
  /** Selected Business money period (This month / Last month / Last 30 days). */
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
  // Default This month — period chips let you flip to Last month / Last 30 days.
  const [moneyPeriod, setMoneyPeriodState] = useState<AdminMoneyPeriodUi>("this_month")
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
          }
        }
        if (!res.ok) throw new Error(json.error ?? "Failed to load admin data")
        setMetrics(json.data?.metrics ?? null)
        setUsers(json.data?.users ?? [])
        setBusinessEconomics(json.data?.business_economics ?? [])
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
    moneyPeriod,
    setMoneyPeriod,
    loading,
    refreshing,
    fetchLatestAdminStats,
  }
}
