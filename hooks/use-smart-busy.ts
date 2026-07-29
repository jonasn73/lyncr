"use client"

// Smart Busy — capacity → recommend / auto-engage Presence Busy (same Busy TeXML path).

import { useCallback, useEffect, useRef, useState } from "react"
import { readActiveOrganizationId, organizationQueryString } from "@/lib/workspace-organizations"
import {
  computeCapacityLoad,
  formatSmartBusyCapacitySummary,
  isAtCapacity,
  readSmartBusyLocalState,
  shouldAutoEngageBusy,
  shouldAutoRevertBusy,
  shouldRecommendBusy,
  writeSmartBusyLocalState,
  SMART_BUSY_EMPTY_LOCAL,
  type SmartBusyLocalState,
} from "@/lib/smart-busy"
import { PRESENCE_BUSY_WRITE_STATUS } from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"
import { useSmartOverflowAutopilot } from "@/hooks/use-smart-overflow-autopilot"
import { useClientSnapshot } from "@/lib/hooks/use-client-seed"
import { useToast } from "@/hooks/use-toast"

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

export function useSmartBusy(routingBusinessNumber?: string | null): UseSmartBusyResult {
  const { toast } = useToast()
  const { presenceStatus, setPresenceStatus, saving: presenceSaving } = useAccountPresence()
  const overflow = useSmartOverflowAutopilot(routingBusinessNumber)

  // localStorage seed on first client snapshot (useState initializer is stuck on SSR false).
  const cachedLocal = useClientSnapshot(
    readSmartBusyLocalState,
    () => SMART_BUSY_EMPTY_LOCAL,
    "smart-busy-local"
  )
  const [liveLocal, setLiveLocal] = useState<SmartBusyLocalState | null>(null)
  const local = liveLocal ?? cachedLocal
  const [poolCount, setPoolCount] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const autoActionRef = useRef<"engage" | "revert" | null>(null)

  const persistLocal = useCallback((next: SmartBusyLocalState) => {
    setLiveLocal(next)
    writeSmartBusyLocalState(next)
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
  }, [local, persistLocal, setPresenceStatus, toast])

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
  }, [atCapacity, local, persistLocal, setPresenceStatus, toast])

  // Auto-engage / auto-revert when Smart Busy is on (toast + easy revert — never silent forever).
  useEffect(() => {
    if (!hydrated || presenceSaving || saving) return
    if (overflow.loading) return

    if (
      shouldAutoEngageBusy({
        smartBusyEnabled: local.enabled,
        atCapacity,
        presenceStatus,
        suppressed: local.suppressed,
      })
    ) {
      if (autoActionRef.current === "engage") return
      autoActionRef.current = "engage"
      persistLocal({ enabled: true, engaged: true, suppressed: false })
      void setPresenceStatus(PRESENCE_BUSY_WRITE_STATUS).then(() => {
        toast({
          title: "Smart Busy engaged",
          description: `Calendar full (${capacitySummary}). Callers get booking text — tap Available anytime.`,
        })
      })
      return
    }

    if (
      shouldAutoRevertBusy({
        smartBusyEnabled: local.enabled,
        atCapacity,
        presenceStatus,
        smartBusyEngaged: local.engaged,
      })
    ) {
      if (autoActionRef.current === "revert") return
      autoActionRef.current = "revert"
      persistLocal({ enabled: true, engaged: false, suppressed: false })
      void setPresenceStatus("AVAILABLE").then(() => {
        toast({
          title: "Smart Busy cleared",
          description: "Capacity is back under the limit — you’re Available again.",
        })
      })
      return
    }

    autoActionRef.current = null
  }, [
    hydrated,
    presenceSaving,
    saving,
    overflow.loading,
    local.enabled,
    local.engaged,
    local.suppressed,
    atCapacity,
    presenceStatus,
    capacitySummary,
    persistLocal,
    setPresenceStatus,
    toast,
  ])

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
    loading: (!hydrated && liveLocal == null && !cachedLocal.enabled) || overflow.loading,
    saving: saving || presenceSaving,
    enableBusy,
    revertToAvailable,
  }
}
