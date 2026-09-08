"use client"

// Data loader for /admin/industries — one GET, no periods/filters to manage.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { AdminIndustryOverviewRow } from "@/lib/admin-industries-overview"

export function useAdminIndustriesOverview() {
  const [industries, setIndustries] = useState<AdminIndustryOverviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch("/api/admin/industries/overview", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        error?: string
        data?: { industries?: AdminIndustryOverviewRow[] }
      }
      if (!res.ok) throw new Error(json.error ?? "Failed to load industry overview")
      setIndustries(json.data?.industries ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load industry overview")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview])

  return { industries, loading, refreshing, refetch: () => fetchOverview(true) }
}
