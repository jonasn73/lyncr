// Smart Overflow Autopilot — capacity-aware next-slot offers + AI booking stubs.
// Pure helpers operate on the global SchedulerEvent array (same shape the calendar uses).

import {
  combineDateAndTime,
  defaultIntakeScheduleDate,
  eventsOnScheduleDay,
  parseScheduleDateKey,
  scheduleTimeSlotOptions,
  suggestNextOpenTime,
} from "@/lib/intake-schedule-helpers"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import type { ScheduleBlockout, SchedulerEvent, UnassignedPoolJob } from "@/lib/types"
import { UNASSIGNED_POOL_STATUS } from "@/lib/job-pool"

/** How Smart Overflow decides to turn itself on. */
export type SmartOverflowMode = "manual" | "auto_capacity"

/** Persisted / UI configuration for the Smart Overflow Autopilot engine. */
export type SmartOverflowConfig = {
  /** Mode A = operator toggle; Mode B = auto when day is over capacity. */
  mode: SmartOverflowMode
  /** Manual Toggle — true when the operator is off-duty and wants AI overflow. */
  manualEnabled: boolean
  /** Mode B threshold — activate when confirmed jobs on the active day exceed this. */
  capacityThreshold: number
}

/** Default capacity before Auto-On Full Capacity trips (confirmed jobs on the day). */
export const SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD = 6

export const DEFAULT_SMART_OVERFLOW_CONFIG: SmartOverflowConfig = {
  mode: "manual",
  manualEnabled: false,
  capacityThreshold: SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
}

/** Result of scanning the calendar for the next free 1-hour service block. */
export type NextAvailableSlot = {
  /** Human label for UI + voice prompts (e.g. "Tomorrow at 9:00 AM"). */
  text: string
  /** Calendar day key YYYY-MM-DD. */
  dateKey: string
  /** Local time HH:mm (24h). */
  timeValue: string
  /** Local datetime string suitable for Date.parse / booking. */
  localDateTime: string
  /** ISO timestamp for API payloads. */
  scheduledAtIso: string
}

const ONE_HOUR_MINUTES = 60
const LOOKAHEAD_DAYS = 14

/**
 * Count confirmed (non-tentative) jobs already on a calendar day.
 * Used by Mode B “Auto-On Full Capacity”.
 */
export function countConfirmedJobsOnDay(
  events: readonly SchedulerEvent[],
  dateKey: string
): number {
  return eventsOnScheduleDay([...events], dateKey).filter((ev) => !ev.scheduled_tentative).length
}

/**
 * True when Smart Overflow should route AI live (manual on, or day over capacity).
 */
export function isSmartOverflowActive(
  config: SmartOverflowConfig,
  confirmedJobsToday: number
): boolean {
  if (config.mode === "manual") return config.manualEnabled === true
  return confirmedJobsToday > config.capacityThreshold
}

/** Format a local date key + HH:mm into operator-friendly offer copy. */
export function formatNextAvailableSlotText(
  dateKey: string,
  timeValue: string,
  now = new Date()
): string {
  const slotDate = parseScheduleDateKey(dateKey)
  if (!slotDate) return "Next open morning"

  const todayKey = defaultIntakeScheduleDate(now)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrowKey = defaultIntakeScheduleDate(tomorrow)

  const [hourRaw, minuteRaw] = timeValue.split(":").map(Number)
  const hour = Number.isFinite(hourRaw) ? hourRaw : 9
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0
  const suffix = hour >= 12 ? "PM" : "AM"
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  const minuteLabel = minute === 0 ? ":00" : `:${String(minute).padStart(2, "0")}`
  const clock = `${displayHour}${minuteLabel} ${suffix}`

  if (dateKey === todayKey) return `Today at ${clock}`
  if (dateKey === tomorrowKey) return `Tomorrow at ${clock}`

  // Weekday name for farther slots (e.g. "Monday morning" when before noon).
  const weekday = slotDate.toLocaleDateString(undefined, { weekday: "long" })
  if (hour < 12) return `${weekday} morning`
  if (hour < 17) return `${weekday} at ${clock}`
  return `${weekday} evening`
}

/**
 * Background capacity checker — walks the Scheduler event array and returns the
 * next unassigned 1-hour service block as offer metadata for UI + voice webhooks.
 */
export function getNextAvailableSlot(
  currentDate: Date,
  events: readonly SchedulerEvent[] = [],
  opts?: {
    durationMinutes?: number
    lookaheadDays?: number
    /** Owner blockouts — full-day days skipped; partial windows filter 1-hour slots. */
    blockouts?: readonly ScheduleBlockout[]
  }
): NextAvailableSlot | null {
  const durationMinutes = opts?.durationMinutes ?? ONE_HOUR_MINUTES
  const lookaheadDays = opts?.lookaheadDays ?? LOOKAHEAD_DAYS
  const blockouts = opts?.blockouts ?? []
  const list = [...events]

  for (let offset = 0; offset < lookaheadDays; offset += 1) {
    const day = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() + offset,
      0,
      0,
      0,
      0
    )
    // Skip Sundays in the offer window (closed / Autopilot day → book next open weekday).
    if (day.getDay() === 0) continue

    const dateKey = defaultIntakeScheduleDate(day)
    let startHour = 7
    // On “today”, only offer slots still in the future.
    if (offset === 0) {
      const nowHour = currentDate.getHours()
      const nowMinute = currentDate.getMinutes()
      startHour = Math.max(7, nowMinute > 0 ? nowHour + 1 : nowHour)
      if (startHour >= 19) continue
    }

    const timeValue = suggestNextOpenTime(
      list,
      dateKey,
      durationMinutes,
      null,
      null,
      startHour,
      19,
      blockouts
    )
    if (!timeValue) continue

    const localDateTime = combineDateAndTime(dateKey, timeValue)
    const scheduledAt = new Date(localDateTime)
    if (Number.isNaN(scheduledAt.getTime())) continue

    return {
      text: formatNextAvailableSlotText(dateKey, timeValue, currentDate),
      dateKey,
      timeValue,
      localDateTime,
      scheduledAtIso: scheduledAt.toISOString(),
    }
  }

  // Soft fallback when the grid is packed for two weeks.
  return {
    text: "Monday morning",
    dateKey: defaultIntakeScheduleDate(
      (() => {
        const d = new Date(currentDate)
        d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7))
        return d
      })()
    ),
    timeValue: "09:00",
    localDateTime: "",
    scheduledAtIso: "",
  }
}

/** Payload the voice bot posts when an automated phone registration loop finishes. */
export type AICallBookingReceivedPayload = {
  callerPhone?: string | null
  customerName?: string | null
  jobType?: string | null
  notes?: string | null
  /** Optional override — otherwise we stamp the next open slot. */
  scheduledAtIso?: string | null
  nextAvailableSlotText?: string | null
}

/**
 * Schema block for a new Scheduler pool entry created from an AI voice booking.
 * Matches the UnassignedPoolJob / hopper shape enough for UI merge + POST stubs.
 */
export type SmartOverflowPoolSchemaBlock = {
  id: string
  customer_name: string
  customer_phone: string | null
  location: string | null
  summary: string
  disposition: "BOOKED"
  scheduled_at: string
  scheduled_tentative: boolean
  created_at: string
  job_type: string
  duration_minutes: number
  assigned_tech_id: null
  assigned_tech_name: null
  vehicle_year: null
  vehicle_make: null
  vehicle_model: null
  job_notes: string | null
  latitude: null
  longitude: null
  job_status: null
  dispatch_status: typeof UNASSIGNED_POOL_STATUS
  source: "smart_overflow_ai_booking"
  offer_slot_text: string | null
}

/**
 * Mock event listener — constructs a new Scheduler pool array item when the
 * voice bot completes an automated phone registration loop.
 */
export function onAICallBookingReceived(
  payload: AICallBookingReceivedPayload,
  events: readonly SchedulerEvent[] = [],
  now = new Date()
): {
  poolEntry: SmartOverflowPoolSchemaBlock
  /** Immutable copy of events with the new booking appended (for in-memory engines). */
  nextEvents: SchedulerEvent[]
  nextAvailableSlotText: string
} {
  const slot =
    payload.scheduledAtIso && !Number.isNaN(Date.parse(payload.scheduledAtIso))
      ? {
          text: payload.nextAvailableSlotText?.trim() || "Booked slot",
          scheduledAtIso: payload.scheduledAtIso,
          dateKey: dayKeyLocal(new Date(payload.scheduledAtIso)),
          timeValue: "09:00",
          localDateTime: payload.scheduledAtIso,
        }
      : getNextAvailableSlot(now, events)

  const scheduledAtIso =
    slot?.scheduledAtIso ||
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0).toISOString()
  const offerText = payload.nextAvailableSlotText?.trim() || slot?.text || "Next open morning"
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `ai-book-${crypto.randomUUID()}`
      : `ai-book-${now.getTime()}`

  const poolEntry: SmartOverflowPoolSchemaBlock = {
    id,
    customer_name: (payload.customerName || "AI booking").trim() || "AI booking",
    customer_phone: payload.callerPhone?.trim() || null,
    location: null,
    summary: `Smart Overflow AI booking · Offering ${offerText}`,
    disposition: "BOOKED",
    scheduled_at: scheduledAtIso,
    scheduled_tentative: !slot?.scheduledAtIso,
    created_at: now.toISOString(),
    job_type: (payload.jobType || "Service call").trim() || "Service call",
    duration_minutes: ONE_HOUR_MINUTES,
    assigned_tech_id: null,
    assigned_tech_name: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    job_notes: payload.notes?.trim() || `Voice bot booked via Smart Overflow (${offerText})`,
    latitude: null,
    longitude: null,
    job_status: null,
    dispatch_status: UNASSIGNED_POOL_STATUS,
    source: "smart_overflow_ai_booking",
    offer_slot_text: offerText,
  }

  // Append as a SchedulerEvent so subsequent getNextAvailableSlot calls see the hold.
  const asEvent: SchedulerEvent = {
    id: poolEntry.id,
    customer_name: poolEntry.customer_name,
    customer_phone: poolEntry.customer_phone,
    location: poolEntry.location,
    summary: poolEntry.summary,
    disposition: poolEntry.disposition,
    scheduled_at: poolEntry.scheduled_at,
    scheduled_tentative: poolEntry.scheduled_tentative,
    created_at: poolEntry.created_at,
    job_type: poolEntry.job_type,
    duration_minutes: poolEntry.duration_minutes,
    assigned_tech_id: null,
    assigned_tech_name: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    job_notes: poolEntry.job_notes,
    latitude: null,
    longitude: null,
    job_status: null,
    dispatch_status: poolEntry.dispatch_status,
  }

  return {
    poolEntry,
    nextEvents: [...events, asEvent],
    nextAvailableSlotText: offerText,
  }
}

/** Narrow a pool schema block into UnassignedPoolJob-compatible fields for UI lists. */
export function smartOverflowPoolToUnassignedJob(
  block: SmartOverflowPoolSchemaBlock
): Pick<
  UnassignedPoolJob,
  | "id"
  | "customer_name"
  | "customer_phone"
  | "location"
  | "summary"
  | "disposition"
  | "created_at"
  | "job_type"
  | "job_notes"
  | "dispatch_status"
> & { scheduled_at: string } {
  return {
    id: block.id,
    customer_name: block.customer_name,
    customer_phone: block.customer_phone,
    location: block.location,
    summary: block.summary,
    disposition: block.disposition,
    created_at: block.created_at,
    job_type: block.job_type,
    job_notes: block.job_notes,
    dispatch_status: block.dispatch_status,
    scheduled_at: block.scheduled_at,
  }
}

/** localStorage key for Lines-dashboard Smart Overflow preferences. */
export const SMART_OVERFLOW_STORAGE_KEY = "lyncr.smartOverflowAutopilot.v1"

export function readSmartOverflowConfigFromStorage(): SmartOverflowConfig {
  if (typeof window === "undefined") return { ...DEFAULT_SMART_OVERFLOW_CONFIG }
  try {
    const raw = window.localStorage.getItem(SMART_OVERFLOW_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SMART_OVERFLOW_CONFIG }
    const parsed = JSON.parse(raw) as Partial<SmartOverflowConfig>
    return {
      mode: parsed.mode === "auto_capacity" ? "auto_capacity" : "manual",
      manualEnabled: parsed.manualEnabled === true,
      capacityThreshold:
        typeof parsed.capacityThreshold === "number" && parsed.capacityThreshold > 0
          ? Math.floor(parsed.capacityThreshold)
          : SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD,
    }
  } catch {
    return { ...DEFAULT_SMART_OVERFLOW_CONFIG }
  }
}

export function writeSmartOverflowConfigToStorage(config: SmartOverflowConfig): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SMART_OVERFLOW_STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Expose hour options used by capacity scans (tests + docs). */
export function smartOverflowHourGrid(): { value: string; label: string }[] {
  return scheduleTimeSlotOptions(7, 19, 60)
}
