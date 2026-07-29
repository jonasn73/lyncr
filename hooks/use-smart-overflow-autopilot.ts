"use client"

// Live Smart Overflow IVR Menu — calendar capacity → ivr_menu_enabled sync.
// Presence On-Job / Closed is controlled only by the top Presence bar (no Off-duty switch).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import {
  DEFAULT_SMART_OVERFLOW_CONFIG,
  countConfirmedJobsOnDay,
  getNextAvailableSlot,
  isSmartOverflowActive,
  onAICallBookingReceived,
  SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
  type AICallBookingReceivedPayload,
  type SmartOverflowConfig,
  type SmartOverflowPoolSchemaBlock,
} from "@/lib/smart-overflow-autopilot"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import type { SchedulerEvent } from "@/lib/types"
import { useClientSnapshot } from "@/lib/hooks/use-client-seed"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Lightweight snapshot so the IVR card doesn’t insert late on hard refresh. */
type SmartOverflowCache = {
  capacityThreshold: number
  confirmedJobsToday: number
  overflowActive: boolean
  nextAvailableSlotText: string
  retellConnected: boolean
}

function overflowCacheKey(): string {
  return persistedCacheKey("smart-overflow", readActiveOrganizationId() || "default")
}

function readOverflowCache(): SmartOverflowCache | null {
  const cached = readPersistedCache<SmartOverflowCache>(overflowCacheKey())
  if (!cached || typeof cached.capacityThreshold !== "number") return null
  return cached
}

function writeOverflowCache(snap: SmartOverflowCache) {
  writePersistedCache(overflowCacheKey(), snap)
}

function currentMonthKey(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

async function persistIvrMenuEnabled(
  enabled: boolean,
  routingBusinessNumber: string | null | undefined
): Promise<boolean> {
  try {
    const res = await fetch("/api/routing/ivr", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_number: routingBusinessNumber || null,
        ivrMenuEnabled: enabled,
        ivr_menu_enabled: enabled,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export type UseSmartOverflowAutopilotResult = {
  config: SmartOverflowConfig
  setCapacityThreshold: (next: number) => Promise<void>
  capacitySaving: boolean
  /** True when confirmed jobs today exceed the account capacity threshold. */
  overflowActive: boolean
  nextAvailableSlotText: string
  nextAvailableSlotIso: string | null
  confirmedJobsToday: number
  events: SchedulerEvent[]
  loading: boolean
  retellConnected: boolean
  ingestAICallBooking: (
    payload: AICallBookingReceivedPayload
  ) => Promise<SmartOverflowPoolSchemaBlock | null>
}

export function useSmartOverflowAutopilot(
  routingBusinessNumber?: string | null
): UseSmartOverflowAutopilotResult {
  // Org id is part of the cache key — re-read seed when the workspace changes.
  const overflowRevision =
    typeof window !== "undefined" ? readActiveOrganizationId() || "default" : "default"
  const overflowSeed = useClientSnapshot(readOverflowCache, () => null, overflowRevision)
  const seededThreshold = overflowSeed
    ? Math.max(1, Math.min(40, Math.floor(overflowSeed.capacityThreshold) || 5))
    : null

  const [liveConfig, setConfigState] = useState<SmartOverflowConfig | null>(null)
  // Stable fallback object — a new `{}` every render made `now` churn and could loop effects.
  const config = useMemo<SmartOverflowConfig>(
    () =>
      liveConfig ?? {
        ...DEFAULT_SMART_OVERFLOW_CONFIG,
        mode: "auto_capacity",
        manualEnabled: false,
        capacityThreshold: seededThreshold ?? SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
      },
    [liveConfig, seededThreshold]
  )

  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [eventsReady, setEventsReady] = useState(false)
  const [loading, setLoading] = useState(() => overflowSeed == null)
  const [hydrated, setHydrated] = useState(() => overflowSeed != null)
  const [capacitySaving, setCapacitySaving] = useState(false)
  const [retellOfferText, setRetellOfferText] = useState<string | null>(null)
  const [retellConnected, setRetellConnected] = useState(
    () => overflowSeed?.retellConnected === true
  )
  // Seeded from sessionStorage so overflow card can paint before calendar fetch.
  const seedConfirmedJobs =
    overflowSeed && typeof overflowSeed.confirmedJobsToday === "number"
      ? overflowSeed.confirmedJobsToday
      : null
  const seedNextSlotText = overflowSeed?.nextAvailableSlotText ?? null
  const hasOverflowCacheRef = useRef(overflowSeed != null)
  const lastSyncedIvrEnabled = useRef<boolean | null>(null)

  // Load capacity threshold from account_settings (source of truth).
  useEffect(() => {
    let cancelled = false
    void fetch("/api/routing/ivr-capacity", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null
        const json = (await res.json()) as {
          data?: { ivrCapacityThreshold?: number; ivr_capacity_threshold?: number }
        }
        return json.data || null
      })
      .then((data) => {
        if (cancelled || !data) {
          if (!cancelled) setHydrated(true)
          return
        }
        const threshold =
          typeof data.ivrCapacityThreshold === "number"
            ? data.ivrCapacityThreshold
            : typeof data.ivr_capacity_threshold === "number"
              ? data.ivr_capacity_threshold
              : SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD
        setConfigState({
          mode: "auto_capacity",
          manualEnabled: false,
          capacityThreshold: Math.max(1, Math.min(40, Math.floor(threshold) || 5)),
        })
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setCapacityThreshold = useCallback(async (next: number) => {
    const threshold = Math.max(1, Math.min(40, Math.floor(next) || 1))
    setConfigState({
      mode: "auto_capacity",
      manualEnabled: false,
      capacityThreshold: threshold,
    })
    setCapacitySaving(true)
    try {
      const res = await fetch("/api/routing/ivr-capacity", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ivrCapacityThreshold: threshold,
          ivr_capacity_threshold: threshold,
        }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string; migration?: string }
        console.warn("[smart-overflow] capacity save failed:", json.error || res.statusText)
      }
    } catch (e) {
      console.warn("[smart-overflow] capacity save failed:", e)
    } finally {
      setCapacitySaving(false)
    }
  }, [])

  // Pull the live calendar month so capacity + next-slot stay data-aware.
  useEffect(() => {
    let cancelled = false
    const monthKey = currentMonthKey()
    const orgId = readActiveOrganizationId()
    const orgQs = orgId ? `&organization_id=${encodeURIComponent(orgId)}` : ""

    // Don’t dim the card when we already painted from cache.
    if (!hasOverflowCacheRef.current) setLoading(true)
    void fetch(`/api/owner/scheduler/bootstrap?month=${encodeURIComponent(monthKey)}${orgQs}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return [] as SchedulerEvent[]
        const json = (await res.json()) as {
          data?: { events?: SchedulerEvent[] }
          events?: SchedulerEvent[]
        }
        return json.data?.events ?? json.events ?? []
      })
      .then((list) => {
        if (!cancelled) {
          setEvents(Array.isArray(list) ? list : [])
          setEventsReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([])
          setEventsReady(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Depend on capacity threshold (primitive), not `config` object identity.
  const now = useMemo(
    () => new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh slot math when calendar / threshold settles
    [events, config.capacityThreshold, hydrated]
  )
  const todayKey = defaultIntakeScheduleDate(now)
  const confirmedFromEvents = useMemo(
    () => countConfirmedJobsOnDay(events, todayKey),
    [events, todayKey]
  )
  // Prefer live calendar counts once ready; otherwise use the cached seed.
  const confirmedJobsToday = eventsReady
    ? confirmedFromEvents
    : (seedConfirmedJobs ?? confirmedFromEvents)
  const overflowActive = hydrated && isSmartOverflowActive(config, confirmedJobsToday)
  const nextSlot = useMemo(() => getNextAvailableSlot(now, events), [now, events])

  // Persist a small snapshot whenever overflow math settles (next refresh paints instantly).
  useEffect(() => {
    if (!hydrated || !eventsReady) return
    writeOverflowCache({
      capacityThreshold: config.capacityThreshold,
      confirmedJobsToday,
      overflowActive,
      nextAvailableSlotText: retellOfferText || nextSlot?.text || "Monday morning",
      retellConnected,
    })
  }, [
    hydrated,
    eventsReady,
    config.capacityThreshold,
    confirmedJobsToday,
    overflowActive,
    retellOfferText,
    nextSlot?.text,
    retellConnected,
  ])

  // Capacity used to flip ivr_menu_enabled=true and made the dashboard look like
  // "Automation 100%" even while Presence was Available. Webhook routing is
  // presence-driven (Available → dial cell first), so do not auto-enable IVR here.
  // Only clear a stale IVR-on flag when capacity is back under threshold.
  useEffect(() => {
    if (!hydrated) return
    if (overflowActive) {
      lastSyncedIvrEnabled.current = true
      return
    }
    if (lastSyncedIvrEnabled.current === false) return
    lastSyncedIvrEnabled.current = false
    void persistIvrMenuEnabled(false, routingBusinessNumber)
  }, [overflowActive, hydrated, routingBusinessNumber])

  useEffect(() => {
    if (!overflowActive) {
      setRetellOfferText(null)
      return
    }

    let cancelled = false
    const pull = () => {
      void fetch("/api/retell-booking", { credentials: "include" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`retell ${res.status}`)
          const json = (await res.json()) as {
            data?: { available_slot_raw?: string; offering?: string }
          }
          const raw = json.data?.available_slot_raw?.trim()
          if (!cancelled) {
            setRetellConnected(true)
            if (raw) setRetellOfferText(raw)
          }
        })
        .catch(() => {
          if (!cancelled) setRetellConnected(false)
        })
    }

    pull()
    const id = window.setInterval(pull, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [overflowActive])

  const ingestAICallBooking = useCallback(
    async (payload: AICallBookingReceivedPayload) => {
      const local = onAICallBookingReceived(payload, events, new Date())
      setEvents(local.nextEvents)

      try {
        const res = await fetch("/api/retell-booking", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "confirm_monday_booking",
            args: {
              customerName: payload.customerName,
              customerPhone: payload.callerPhone,
              jobType: payload.jobType,
            },
          }),
        })
        if (!res.ok) return local.poolEntry
        const json = (await res.json()) as {
          appointment?: SmartOverflowPoolSchemaBlock
          available_slot_raw?: string
        }
        if (json.available_slot_raw) setRetellOfferText(json.available_slot_raw)
        setRetellConnected(true)
        return json.appointment ?? local.poolEntry
      } catch {
        return local.poolEntry
      }
    },
    [events]
  )

  return {
    config,
    setCapacityThreshold,
    capacitySaving,
    overflowActive,
    nextAvailableSlotText:
      retellOfferText || nextSlot?.text || seedNextSlotText || "Monday morning",
    nextAvailableSlotIso: nextSlot?.scheduledAtIso || null,
    confirmedJobsToday,
    events,
    // After cache paint, don’t report “loading” (avoids opacity flash on the IVR card).
    loading: !hasOverflowCacheRef.current && (loading || !hydrated),
    retellConnected,
    ingestAICallBooking,
  }
}
