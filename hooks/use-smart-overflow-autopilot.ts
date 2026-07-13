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
  const [config, setConfigState] = useState<SmartOverflowConfig>({
    ...DEFAULT_SMART_OVERFLOW_CONFIG,
    mode: "auto_capacity",
    manualEnabled: false,
    capacityThreshold: SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
  })
  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [capacitySaving, setCapacitySaving] = useState(false)
  const [retellOfferText, setRetellOfferText] = useState<string | null>(null)
  const [retellConnected, setRetellConnected] = useState(false)
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
    setConfigState((prev) => ({
      ...prev,
      mode: "auto_capacity",
      manualEnabled: false,
      capacityThreshold: threshold,
    }))
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

    setLoading(true)
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
        if (!cancelled) setEvents(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const now = useMemo(() => new Date(), [events, config, hydrated])
  const todayKey = defaultIntakeScheduleDate(now)
  const confirmedJobsToday = useMemo(
    () => countConfirmedJobsOnDay(events, todayKey),
    [events, todayKey]
  )
  const overflowActive = hydrated && isSmartOverflowActive(config, confirmedJobsToday)
  const nextSlot = useMemo(() => getNextAvailableSlot(now, events), [now, events])

  // Keep Telnyx routing in sync when capacity auto-bypass trips or clears.
  useEffect(() => {
    if (!hydrated) return
    const enabled = overflowActive
    if (lastSyncedIvrEnabled.current === enabled) return
    lastSyncedIvrEnabled.current = enabled
    void persistIvrMenuEnabled(enabled, routingBusinessNumber)
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
    nextAvailableSlotText: retellOfferText || nextSlot?.text || "Monday morning",
    nextAvailableSlotIso: nextSlot?.scheduledAtIso || null,
    confirmedJobsToday,
    events,
    loading: loading || !hydrated,
    retellConnected,
    ingestAICallBooking,
  }
}
