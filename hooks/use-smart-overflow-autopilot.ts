"use client"

// Live Smart Overflow IVR Menu — calendar capacity + Off-duty → ivr_menu_enabled sync.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import {
  DEFAULT_SMART_OVERFLOW_CONFIG,
  countConfirmedJobsOnDay,
  getNextAvailableSlot,
  isSmartOverflowActive,
  onAICallBookingReceived,
  readSmartOverflowConfigFromStorage,
  writeSmartOverflowConfigToStorage,
  type AICallBookingReceivedPayload,
  type SmartOverflowConfig,
  type SmartOverflowPoolSchemaBlock,
} from "@/lib/smart-overflow-autopilot"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import type { SchedulerEvent } from "@/lib/types"
import type { IvrMenuSettings } from "@/lib/ivr-menu-settings"

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
  setConfig: (next: SmartOverflowConfig) => void
  /** True when Manual Off-duty is on or Auto-On Full Capacity trips. */
  overflowActive: boolean
  nextAvailableSlotText: string
  nextAvailableSlotIso: string | null
  confirmedJobsToday: number
  events: SchedulerEvent[]
  loading: boolean
  /** Retell webhook bridge reachable (GET /api/retell-booking) — optional diagnostics. */
  retellConnected: boolean
  /** Append a mock AI booking into the local event array (and optional server stub). */
  ingestAICallBooking: (
    payload: AICallBookingReceivedPayload
  ) => Promise<SmartOverflowPoolSchemaBlock | null>
}

export function useSmartOverflowAutopilot(
  routingBusinessNumber?: string | null
): UseSmartOverflowAutopilotResult {
  const [config, setConfigState] = useState<SmartOverflowConfig>(DEFAULT_SMART_OVERFLOW_CONFIG)
  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [ivrReady, setIvrReady] = useState(false)
  const [retellOfferText, setRetellOfferText] = useState<string | null>(null)
  const [retellConnected, setRetellConnected] = useState(false)
  const lastSyncedIvrEnabled = useRef<boolean | null>(null)

  // Restore Mode A / Mode B preferences after mount (avoid SSR mismatch).
  useEffect(() => {
    setConfigState(readSmartOverflowConfigFromStorage())
    setHydrated(true)
  }, [])

  // Load Off-duty (ivr_menu_enabled) from DB for this business line.
  useEffect(() => {
    let cancelled = false
    setIvrReady(false)
    const qs = routingBusinessNumber
      ? `?number=${encodeURIComponent(routingBusinessNumber)}`
      : ""
    void fetch(`/api/routing/ivr${qs}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null
        const json = (await res.json()) as { data?: IvrMenuSettings & { ivr_menu_enabled?: boolean } }
        return json.data || null
      })
      .then((data) => {
        if (cancelled || !data) {
          if (!cancelled) setIvrReady(true)
          return
        }
        const enabled = data.ivrMenuEnabled === true || data.ivr_menu_enabled === true
        lastSyncedIvrEnabled.current = enabled
        setConfigState((prev) => {
          const next: SmartOverflowConfig = {
            ...prev,
            // Prefer DB Off-duty flag when present; keep auto threshold from local storage.
            manualEnabled: enabled,
          }
          writeSmartOverflowConfigToStorage(next)
          return next
        })
        setIvrReady(true)
      })
      .catch(() => {
        if (!cancelled) setIvrReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [routingBusinessNumber])

  const setConfig = useCallback(
    (next: SmartOverflowConfig) => {
      setConfigState(next)
      writeSmartOverflowConfigToStorage(next)
      // Immediate persist when the Off-duty switch flips in Manual mode.
      if (next.mode === "manual") {
        const enabled = next.manualEnabled === true
        if (lastSyncedIvrEnabled.current !== enabled) {
          lastSyncedIvrEnabled.current = enabled
          void persistIvrMenuEnabled(enabled, routingBusinessNumber)
        }
      }
    },
    [routingBusinessNumber]
  )

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

  // Keep Telnyx routing in sync when Auto-On Full Capacity trips or clears.
  useEffect(() => {
    if (!hydrated || !ivrReady) return
    const enabled = overflowActive
    if (lastSyncedIvrEnabled.current === enabled) return
    lastSyncedIvrEnabled.current = enabled
    void persistIvrMenuEnabled(enabled, routingBusinessNumber)
  }, [overflowActive, hydrated, ivrReady, routingBusinessNumber])

  // Optional Retell offer text while overflow is active (diagnostics / next-slot copy).
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
    setConfig,
    overflowActive,
    nextAvailableSlotText: retellOfferText || nextSlot?.text || "Monday morning",
    nextAvailableSlotIso: nextSlot?.scheduledAtIso || null,
    confirmedJobsToday,
    events,
    loading: loading || !ivrReady,
    retellConnected,
    ingestAICallBooking,
  }
}
