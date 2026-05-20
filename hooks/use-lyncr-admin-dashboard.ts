"use client"

// Shared admin console data loader — single fetch + refresh without full page reload.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { LyncrAdminDirectoryRow, LyncrAdminMetrics } from "@/lib/types"

export type LyncrAdminDashboardData = {
  metrics: LyncrAdminMetrics | null
  users: LyncrAdminDirectoryRow[]
  loading: boolean
  refreshing: boolean
  refreshAdminData: (silent?: boolean) => Promise<void>
}

export function useLyncrAdminDashboardData(): LyncrAdminDashboardData {
  const [metrics, setMetrics] = useState<LyncrAdminMetrics | null>(null)
  const [users, setUsers] = useState<LyncrAdminDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const refreshAdminData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch("/api/admin/data", { credentials: "include", cache: "no-store" })
      const json = (await res.json()) as {
        error?: string
        data?: { metrics?: LyncrAdminMetrics; users?: LyncrAdminDirectoryRow[] }
      }
      if (!res.ok) throw new Error(json.error ?? "Failed to load admin data")
      setMetrics(json.data?.metrics ?? null)
      setUsers(json.data?.users ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load admin data")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshAdminData()
  }, [refreshAdminData])

  return { metrics, users, loading, refreshing, refreshAdminData }
}
