// Pure helpers — filter open appointment slots against ScheduleBlockout rows.

import {
  combineDateAndTime,
  isScheduleDateTimeValid,
  scheduleTimeSlotOptions,
} from "@/lib/intake-schedule-helpers"
import type { ScheduleBlockout } from "@/lib/types"

/** True when this calendar day has at least one full-day blockout. */
export function isDateFullyBlocked(
  blockouts: readonly ScheduleBlockout[],
  dateKey: string
): boolean {
  return blockouts.some((b) => b.date === dateKey && b.is_full_day === true)
}

/** Blockouts that apply to a single YYYY-MM-DD day. */
export function blockoutsOnDate(
  blockouts: readonly ScheduleBlockout[],
  dateKey: string
): ScheduleBlockout[] {
  return blockouts.filter((b) => b.date === dateKey)
}

/** Minutes since local midnight for an HH:mm string (or null if invalid). */
export function parseHhMmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || typeof hhmm !== "string") return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

/**
 * True when a proposed appointment [timeValue, +durationMinutes) overlaps any
 * partial blockout window on that day. Full-day days should be rejected via
 * {@link isDateFullyBlocked} before calling this.
 */
export function slotOverlapsBlockout(
  blockouts: readonly ScheduleBlockout[],
  dateKey: string,
  timeValue: string,
  durationMinutes: number
): boolean {
  if (!isScheduleDateTimeValid(dateKey, timeValue)) return false
  const slotStart = parseHhMmToMinutes(timeValue)
  if (slotStart == null) return false
  const slotEnd = slotStart + Math.max(durationMinutes, 15)

  for (const b of blockoutsOnDate(blockouts, dateKey)) {
    if (b.is_full_day) return true
    const blockStart = parseHhMmToMinutes(b.start_time)
    const blockEnd = parseHhMmToMinutes(b.end_time)
    if (blockStart == null || blockEnd == null) continue
    // Standard half-open overlap: [slotStart, slotEnd) vs [blockStart, blockEnd).
    if (slotStart < blockEnd && blockStart < slotEnd) return true
  }
  return false
}

/**
 * First open HH:mm on a day that is free of jobs AND blockouts.
 * Returns null when the day is fully blocked or every grid slot conflicts.
 */
export function suggestNextOpenTimeWithBlockouts(params: {
  dateKey: string
  durationMinutes: number
  /** Existing booked events — use findScheduleConflicts / suggestNextOpenTime upstream. */
  isSlotFreeOfJobs: (timeValue: string) => boolean
  blockouts: readonly ScheduleBlockout[]
  startHour?: number
  endHour?: number
}): string | null {
  if (isDateFullyBlocked(params.blockouts, params.dateKey)) return null
  const startHour = params.startHour ?? 7
  const endHour = params.endHour ?? 19
  for (const slot of scheduleTimeSlotOptions(startHour, endHour)) {
    if (!params.isSlotFreeOfJobs(slot.value)) continue
    if (
      slotOverlapsBlockout(
        params.blockouts,
        params.dateKey,
        slot.value,
        params.durationMinutes
      )
    ) {
      continue
    }
    return slot.value
  }
  return null
}

/** Human label for a blockout chip on the calendar. */
export function formatBlockoutLabel(b: ScheduleBlockout): string {
  const reason = (b.reason || "").trim() || "Blocked"
  if (b.is_full_day) return `${reason} · All day`
  const start = b.start_time || "?"
  const end = b.end_time || "?"
  return `${reason} · ${start}–${end}`
}

/** Validate create/update payload from the Add Blockout modal. */
export function validateBlockoutInput(input: {
  date: string
  isFullDay: boolean
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}): { ok: true } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) {
    return { ok: false, error: "Pick a valid date." }
  }
  if (input.isFullDay) return { ok: true }
  const start = (input.startTime || "").trim()
  const end = (input.endTime || "").trim()
  if (!start || !end) {
    return { ok: false, error: "Choose a start and end time." }
  }
  const startMin = parseHhMmToMinutes(start)
  const endMin = parseHhMmToMinutes(end)
  if (startMin == null || endMin == null) {
    return { ok: false, error: "Times must look like 10:30." }
  }
  if (startMin >= endMin) {
    return { ok: false, error: "End time must be after start time." }
  }
  // Ensure combineDateAndTime can parse for local conflict checks.
  if (!combineDateAndTime(input.date, start) || !combineDateAndTime(input.date, end)) {
    return { ok: false, error: "Invalid time range." }
  }
  return { ok: true }
}
