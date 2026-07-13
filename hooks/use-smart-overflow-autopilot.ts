"use client"

// Live Smart Overflow Autopilot — loads month scheduler events and exposes next-slot text.

import { useCallback, useEffect, useMemo, useState } from "react"
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

function currentMonthKey(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

export type UseSmartOverflowAutopilotResult = {
  config: SmartOverflowConfig
  setConfig: (next: SmartOverflowConfig) => void
  /** True when Manual is on or Auto-On Full Capacity trips. */
  overflowActive: boolean
  nextAvailableSlotText: string
  nextAvailableSlotIso: string | null
  confirmedJobsToday: number
  events: SchedulerEvent[]
  loading: boolean
  /** Append a mock AI booking into the local event array (and optional server stub). */
  ingestAICallBooking: (
    payload: AICallBookingReceivedPayload
  ) => Promise<SmartOverflowPoolSchemaBlock | null>
}

export function useSmartOverflowAutopilot(): UseSmartOverflowAutopilotResult {
  const [config, setConfigState] = useState<SmartOverflowConfig>(DEFAULT_SMART_OVERFLOW_CONFIG)
  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  // Restore Mode A / Mode B preferences after mount (avoid SSR mismatch).
  useEffect(() => {
    setConfigState(readSmartOverflowConfigFromStorage())
    setHydrated(true)
  }, [])

  const setConfig = useCallback((next: SmartOverflowConfig) => {
    setConfigState(next)
    writeSmartOverflowConfigToStorage(next)
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
        const json = (await res.json()) as { data?: { events?: SchedulerEvent[] }; events?: SchedulerEvent[] }
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

  const ingestAICallBooking = useCallback(
    async (payload: AICallBookingReceivedPayload) => {
      // Local engine: append into the in-memory Scheduler array immediately.
      const local = onAICallBookingReceived(payload, events, new Date())
      setEvents(local.nextEvents)

      // Server stub — persists a hopper job when auth + DB are available.
      try {
        const res = await fetch("/api/voice/telnyx/ai-booking-received", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            scheduledAtIso: local.poolEntry.scheduled_at,
            nextAvailableSlotText: local.nextAvailableSlotText,
          }),
        })
        if (!res.ok) return local.poolEntry
        const json = (await res.json()) as { data?: { poolEntry?: SmartOverflowPoolSchemaBlock } }
        return json.data?.poolEntry ?? local.poolEntry
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
    nextAvailableSlotText: nextSlot?.text ?? "Monday morning",
    nextAvailableSlotIso: nextSlot?.scheduledAtIso || null,
    confirmedJobsToday,
    events,
    loading,
    ingestAICallBooking,
  }
}
