"use client"

// Data loader for /admin/infra's System Health panel — Neon/Telnyx up-down status plus
// Telnyx webhook signature-verification state.

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

export type PlatformCheckStatus = {
  status: "ok" | "error" | "unconfigured" | "unknown"
  last_error_at: string | null
  last_ok_at: string | null
}

export type WebhookRouteHealth = {
  route_label: string
  enforced: boolean
  event_count_since_last_alert: number
  first_event_at: string | null
  last_event_at: string | null
  last_alerted_at: string | null
}

export type SystemHealthData = {
  neon: PlatformCheckStatus
  telnyx: PlatformCheckStatus
  webhook_routes: WebhookRouteHealth[]
}

export function useAdminSystemHealth() {
  const [data, setData] = useState<SystemHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchHealth = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch("/api/admin/system-health", { credentials: "include", cache: "no-store" })
      const json = (await res.json()) as { error?: string; data?: SystemHealthData }
      if (!res.ok) throw new Error(json.error ?? "Failed to load system health")
      setData(json.data ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load system health")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchHealth()
  }, [fetchHealth])

  return { data, loading, refreshing, refetch: () => fetchHealth(true) }
}
