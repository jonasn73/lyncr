"use client"

// Smart Busy — manual toggle only (auto-engage removed; it was a React #185 flash→crash source).

import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { readActiveOrganizationId, organizationQueryString } from "@/lib/workspace-organizations"
import {
  readSmartBusyLocalState,
  writeSmartBusyLocalState,
  SMART_BUSY_EMPTY_LOCAL,
  type SmartBusyLocalState,
} from "@/lib/smart-busy"
import { PRESENCE_BUSY_WRITE_STATUS } from "@/lib/account-presence"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"
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
  enableBusy: () => Promise<void>
  revertToAvailable: () => Promise<void>
}

function localEqual(a: SmartBusyLocalState, b: SmartBusyLocalState): boolean {
  return a.enabled === b.enabled && a.engaged === b.engaged && a.suppressed === b.suppressed
}

export function useSmartBusy(_routingBusinessNumber?: string | null): UseSmartBusyResult {
  void _routingBusinessNumber
  const { presenceStatus, setPresenceStatus, saving: presenceSaving } = useAccountPresence()

  // Sync-read localStorage on first paint — no empty→Busy flash.
  const [liveLocal, setLiveLocal] = useState<SmartBusyLocalState>(() => readSmartBusyLocalState())
  const local = liveLocal
  const [hydrated, setHydrated] = useState(() => {
    if (typeof window === "undefined") return false
    return !localEqual(readSmartBusyLocalState(), SMART_BUSY_EMPTY_LOCAL)
  })
  const [saving, setSaving] = useState(false)

  useLayoutEffect(() => {
    const prev = readSmartBusyLocalState()
    setLiveLocal((cur) => {
      if (localEqual(cur, prev)) return cur
      return prev
    })
  }, [])

  const persistLocal = useCallback((next: SmartBusyLocalState) => {
    setLiveLocal((prev) => {
      if (localEqual(prev, next)) return prev
      writeSmartBusyLocalState(next)
      return next
    })
  }, [])

  // One-shot hydrate — never depends on unstable objects.
  useEffect(() => {
    let cancelled = false
    const orgQs = organizationQueryString(readActiveOrganizationId())
    void fetch(`/api/routing/smart-busy${orgQs}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null
        return (await res.json()) as {
          data?: { smartBusyEnabled?: boolean; smart_busy_enabled?: boolean }
        }
      })
      .then((json) => {
        if (cancelled) return
        const prev = readSmartBusyLocalState()
        const enabled =
          json?.data?.smartBusyEnabled === true || json?.data?.smart_busy_enabled === true
        persistLocal({
          enabled: json?.data ? enabled : prev.enabled,
          engaged: prev.engaged,
          suppressed: prev.suppressed,
        })
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) {
          persistLocal(readSmartBusyLocalState())
          setHydrated(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [persistLocal])

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
            ? "Preference saved. Use Busy manually when the calendar is full."
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
    [local, persistLocal]
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
    persistLocal({ ...local, engaged: false, suppressed: false })
    await setPresenceStatus("AVAILABLE")
    toast({
      title: "Back to Available",
      description: "Your phone will ring first again.",
    })
  }, [local, persistLocal, setPresenceStatus])

  void presenceStatus

  return {
    smartBusyEnabled: local.enabled,
    setSmartBusyEnabled,
    smartBusyEngaged: local.engaged,
    // Capacity auto-logic disabled until #185 is fully gone.
    atCapacity: false,
    recommendBusy: false,
    confirmedJobsToday: 0,
    poolCount: 0,
    capacityLoad: 0,
    capacityThreshold: 5,
    capacitySummary: hydrated ? "Manual Busy only" : "Loading…",
    loading: !hydrated,
    saving: saving || presenceSaving,
    enableBusy,
    revertToAvailable,
  }
}
