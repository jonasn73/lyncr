"use client"

// Smart Busy — capacity → recommend / auto-engage Presence Busy (same Busy TeXML path).

import { useCallback, useEffect, useState } from "react"
import { readActiveOrganizationId, organizationQueryString } from "@/lib/workspace-organizations"
import {
  computeCapacityLoad,
  formatSmartBusyCapacitySummary,
  isAtCapacity,
  readSmartBusyLocalState,
  shouldRecommendBusy,
  writeSmartBusyLocalState,
  SMART_BUSY_EMPTY_LOCAL,
  type SmartBusyLocalState,
} from "@/lib/smart-busy"
import { PRESENCE_BUSY_WRITE_STATUS } from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"
import { useSmartOverflowAutopilot } from "@/hooks/use-smart-overflow-autopilot"
import { toast } from "@/hooks/use-toast"

export type UseSmartBusyResult = {
  smartBusyEnabled: boolean
  setSmartBusyEnabled: (next: boolean) => Promise<void>
  smartBusyEngaged: boolean
  atCapacity: boolean
  recommendBusy: boolean
  confirmedJobsToday: number
  poolCount: number
  capacityLoad: number
  capacityThreshold: number
  capacitySummary: string
  loading: boolean
  saving: boolean
  /** One-tap Enable Busy (manual Busy path — same routing as Presence bar). */
  enableBusy: () => Promise<void>
  /** Easy revert to Available (suppresses re-engage until capacity clears). */
  revertToAvailable: () => Promise<void>
}

function smartBusyLocalEqual(a: SmartBusyLocalState, b: SmartBusyLocalState): boolean {
  return a.enabled === b.enabled && a.engaged === b.engaged && a.suppressed === b.suppressed
}

export function useSmartBusy(routingBusinessNumber?: string | null): UseSmartBusyResult {
  const { presenceStatus, setPresenceStatus, saving: presenceSaving } = useAccountPresence()
  const overflow = useSmartOverflowAutopilot(routingBusinessNumber)

  // localStorage preference loads via API hydrate below (no useClientSnapshot — React #185).
  const [liveLocal, setLiveLocal] = useState<SmartBusyLocalState | null>(null)
  const local = liveLocal ?? SMART_BUSY_EMPTY_LOCAL
  const [poolCount, setPoolCount] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)

  const persistLocal = useCallback((next: SmartBusyLocalState) => {
    setLiveLocal((prev) => {
      const base = prev ?? SMART_BUSY_EMPTY_LOCAL
      if (smartBusyLocalEqual(base, next)) return prev
      writeSmartBusyLocalState(next)
      return next
    })
  }, [])

  // Hydrate preference from account_settings (falls back to localStorage).
  useEffect(() => {
    let cancelled = false
    const orgQs = organizationQueryString(readActiveOrganizationId())
    void fetch(`/api/routing/smart-busy${orgQs}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null
        return (await res.json()) as {
          data?: {
            smartBusyEnabled?: boolean
            smart_busy_enabled?: boolean
            pool_count?: number
          }
        }
      })
      .then((json) => {
        if (cancelled || !json?.data) {
          if (!cancelled) setHydrated(true)
          return
        }
        const enabled =
          json.data.smartBusyEnabled === true || json.data.smart_busy_enabled === true
        const pool =
          typeof json.data.pool_count === "number" ? Math.max(0, json.data.pool_count) : 0
        setPoolCount(pool)
        const prev = readSmartBusyLocalState()
        persistLocal({
          enabled,
          engaged: prev.engaged,
          suppressed: prev.suppressed,
        })
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [persistLocal])

  // Refresh pool count periodically (hopper size is part of capacity load).
  useEffect(() => {
    let cancelled = false
    const pull = () => {
      const orgQs = organizationQueryString(readActiveOrganizationId())
      void fetch(`/api/owner/jobs/pool${orgQs}`, { credentials: "include", cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return []
          const json = (await res.json()) as { data?: { jobs?: unknown[] } }
          return Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
        })
        .then((jobs) => {
          if (!cancelled) setPoolCount(jobs.length)
        })
        .catch(() => {
          /* keep last pool count */
        })
    }
    pull()
    const id = window.setInterval(pull, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const capacityThreshold = overflow.config.capacityThreshold
  const confirmedJobsToday = overflow.confirmedJobsToday
  const capacityLoad = computeCapacityLoad({ confirmedJobsToday, poolCount })
  const atCapacity = hydrated && isAtCapacity(capacityLoad, capacityThreshold)
  const recommendBusy = shouldRecommendBusy({ atCapacity, presenceStatus })
  const capacitySummary = formatSmartBusyCapacitySummary({
    confirmedJobsToday,
    poolCount,
    capacityThreshold,
  })

  // Clear suppress once capacity is healthy again so Smart Busy can re-arm later.
  useEffect(() => {
    if (!hydrated) return
    if (!atCapacity && local.suppressed) {
      persistLocal({
        enabled: local.enabled,
        engaged: local.engaged,
        suppressed: false,
      })
    }
    // Intentionally omit `local` object identity — only these fields gate the write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, atCapacity, local.suppressed, local.enabled, local.engaged, persistLocal])

  const setSmartBusyEnabled = useCallback(
    async (next: boolean) => {
      const prev = local
      persistLocal({
        enabled: next,
        engaged: next ? local.engaged : false,
        suppressed: next ? local.suppressed : false,
      })
      setSaving(true)
      try {
        const orgQs = organizationQueryString(readActiveOrganizationId())
        const res = await fetch(`/api/routing/smart-busy${orgQs}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smart_busy_enabled: next, smartBusyEnabled: next }),
        })
        const json = (await res.json()) as { error?: string; migration?: string }
        if (!res.ok) {
          persistLocal(prev)
          toast({
            title: "Could not update Smart Busy",
            description: json.migration
              ? `Run ${json.migration} in Neon, then try again.`
              : json.error || res.statusText,
            variant: "destructive",
          })
          return
        }
        toast({
          title: next ? "Smart Busy on" : "Smart Busy off",
          description: next
            ? "When the calendar is full, we’ll switch to Busy so new callers get booking text."
            : "Presence stays under your manual control.",
        })
      } catch (e) {
        persistLocal(prev)
        toast({
          title: "Could not update Smart Busy",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setSaving(false)
      }
    },
    [local, persistLocal, toast]
  )

  const enableBusy = useCallback(async () => {
    persistLocal({ ...local, engaged: true, suppressed: false })
    await setPresenceStatus(PRESENCE_BUSY_WRITE_STATUS)
    toast({
      title: "Busy enabled",
      description: "New callers skip your phone and get booking text / IVR.",
    })
  }, [local, persistLocal, setPresenceStatus])

  const revertToAvailable = useCallback(async () => {
    // If still full, suppress re-engage until capacity clears.
    persistLocal({
      ...local,
      engaged: false,
      suppressed: atCapacity,
    })
    await setPresenceStatus("AVAILABLE")
    toast({
      title: "Back to Available",
      description: atCapacity
        ? "Your phone rings first again. Smart Busy won’t re-engage until capacity clears."
        : "Your phone will ring first again.",
    })
  }, [atCapacity, local, persistLocal, setPresenceStatus])

  // Auto-engage / auto-revert DISABLED — presence setState + toast on mount was a
  // React #185 flash→error candidate after session-seed patches. Manual Busy still works.

  return {
    smartBusyEnabled: local.enabled,
    setSmartBusyEnabled,
    smartBusyEngaged: local.engaged,
    atCapacity,
    recommendBusy,
    confirmedJobsToday,
    poolCount,
    capacityLoad,
    capacityThreshold,
    capacitySummary,
    // Cached localStorage means the toggle can paint without waiting on the API.
    loading: !hydrated || overflow.loading,
    saving: saving || presenceSaving,
    enableBusy,
    revertToAvailable,
  }
}
