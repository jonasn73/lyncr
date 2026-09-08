"use client"

// Data loader for /admin/audit — filterable feed, plus the directory list for the
// account picker (reuses the existing lightweight /api/admin/directory endpoint).

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { AuditEventRow } from "@/lib/db"
import type { LyncrAdminDirectoryRow } from "@/lib/types"

export type AdminAuditFilters = {
  ownerUserId: string | null
  eventType: string | null
  entityId: string | null
}

export function useAdminAuditEvents() {
  const [filters, setFilters] = useState<AdminAuditFilters>({ ownerUserId: null, eventType: null, entityId: null })
  const [events, setEvents] = useState<AuditEventRow[]>([])
  const [directory, setDirectory] = useState<LyncrAdminDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchEvents = useCallback(async (nextFilters: AdminAuditFilters, silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const params = new URLSearchParams()
      if (nextFilters.ownerUserId) params.set("owner_user_id", nextFilters.ownerUserId)
      if (nextFilters.eventType) params.set("event_type", nextFilters.eventType)
      if (nextFilters.entityId) params.set("entity_id", nextFilters.entityId)
      const res = await fetch(`/api/admin/audit?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: { events?: AuditEventRow[] } }
      if (!res.ok) throw new Error(json.error ?? "Failed to load audit events")
      setEvents(json.data?.events ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load audit events")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchEvents(filters)
    // Directory is loaded once for the account picker — not re-fetched on filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/admin/directory", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: { users: [] } }))
      .then((json: { data?: { users?: LyncrAdminDirectoryRow[] } }) => {
        if (!cancelled) setDirectory(json.data?.users ?? [])
      })
      .catch(() => {
        if (!cancelled) setDirectory([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setFiltersAndRefetch = useCallback(
    (next: AdminAuditFilters) => {
      setFilters(next)
      void fetchEvents(next, true)
    },
    [fetchEvents]
  )

  return {
    events,
    directory,
    filters,
    setFilters: setFiltersAndRefetch,
    loading,
    refreshing,
    refetch: () => fetchEvents(filters, true),
  }
}
