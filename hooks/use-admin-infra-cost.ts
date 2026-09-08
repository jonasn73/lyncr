"use client"

// Data loader for /admin/infra — one GET for this month's Vercel + Neon spend, plus
// the Telnyx prepaid wallet balance.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { InfraCostByCategory } from "@/lib/admin-infra-cost"

export type InfraProviderCost = {
  categories: InfraCostByCategory[]
  spend_cents: number
  budget_cents: number
  percent_of_budget: number
  configured: boolean
  /** False when the provider call itself failed — distinct from genuine $0 spend. */
  data_available: boolean
  /** The actual upstream error when data_available is false — shown directly in the UI. */
  error: string | null
}

/** Balance-vs-floor, not spend-vs-budget — Telnyx is a prepaid wallet, not a monthly invoice. */
export type TelnyxBalanceData = {
  balance_cents: number
  floor_cents: number
  low_balance: boolean
  data_available: boolean
  error: string | null
}

export type InfraCostData = {
  range: { from: string; to: string }
  vercel: InfraProviderCost
  neon: InfraProviderCost
  telnyx: TelnyxBalanceData
}

export function useAdminInfraCost() {
  const [data, setData] = useState<InfraCostData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchCost = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch("/api/admin/infra-cost", { credentials: "include", cache: "no-store" })
      const json = (await res.json()) as { error?: string; data?: InfraCostData }
      if (!res.ok) throw new Error(json.error ?? "Failed to load infra cost")
      setData(json.data ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load infra cost")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchCost()
  }, [fetchCost])

  return { data, loading, refreshing, refetch: () => fetchCost(true) }
}
