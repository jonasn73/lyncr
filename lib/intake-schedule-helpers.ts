// Helpers for the post-intake “Schedule this job” dialog (date + time fields).

import { dayKeyLocal } from "@/lib/scheduler-utils"
import type { SchedulerEvent } from "@/lib/types"

/** Today’s calendar date as YYYY-MM-DD in the local timezone. */
export function defaultIntakeScheduleDate(now = new Date()): string {
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, "0")
  const da = String(now.getDate()).padStart(2, "0")
  return `${y}-${mo}-${da}`
}

/** Next 30-minute slot from now — a sensible default appointment time. */
export function defaultIntakeScheduleTime(now = new Date()): string {
  const next = new Date(now)
  const remainder = next.getMinutes() % 30
  next.setMinutes(next.getMinutes() + (remainder === 0 ? 30 : 30 - remainder), 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setMinutes(next.getMinutes() + 30)
  }
  const h = String(next.getHours()).padStart(2, "0")
  const mi = String(next.getMinutes()).padStart(2, "0")
  return `${h}:${mi}`
}

/** Merge separate date + time strings into datetime-local shape. */
export function combineDateAndTime(dateStr: string, timeStr: string): string {
  const date = dateStr.trim()
  const time = timeStr.trim()
  if (!date || !time) return ""
  return `${date}T${time}`
}

/** True when date + time parse to a real local datetime. */
export function isScheduleDateTimeValid(dateStr: string, timeStr: string): boolean {
  const combined = combineDateAndTime(dateStr, timeStr)
  if (combined.length < 16) return false
  return !Number.isNaN(Date.parse(combined))
}

/** One-line vehicle summary for the schedule dialog header card. */
export function formatIntakeScheduleVehicleLine(job: {
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
}): string | null {
  const parts = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : null
}

/** Parse YYYY-MM-DD into a local Date at midnight. */
export function parseScheduleDateKey(dateKey: string): Date | null {
  const [y, m, d] = dateKey.split("-").map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d, 0, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Month key (YYYY-MM) for bootstrap API queries. */
export function scheduleMonthKeyFromDateKey(dateKey: string): string | null {
  const parts = dateKey.trim().split("-")
  if (parts.length < 2) return null
  return `${parts[0]}-${parts[1]}`
}

/** 15-minute time slots between startHour and endHour (inclusive end). */
export function scheduleTimeSlotOptions(
  startHour = 7,
  endHour = 19,
  stepMinutes = 15
): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = []
  for (let hour = startHour; hour <= endHour; hour += 1) {
    for (let minute = 0; minute < 60; minute += stepMinutes) {
      if (hour === endHour && minute > 0) break
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
      const suffix = hour >= 12 ? "PM" : "AM"
      const displayHour = hour % 12 === 0 ? 12 : hour % 12
      const minuteLabel = minute === 0 ? ":00" : `:${String(minute).padStart(2, "0")}`
      slots.push({ value, label: `${displayHour}${minuteLabel} ${suffix}` })
    }
  }
  return slots
}

/** Human-readable time range for a scheduled event. */
export function formatSchedulerEventWindow(event: SchedulerEvent): string {
  const start = new Date(event.scheduled_at)
  if (Number.isNaN(start.getTime())) return "—"
  const end = new Date(start.getTime() + Math.max(event.duration_minutes, 15) * 60_000)
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return `${fmt(start)} – ${fmt(end)}`
}

/** Events on a calendar day, sorted by start time. */
export function eventsOnScheduleDay(
  events: SchedulerEvent[],
  dateKey: string,
  excludeJobId?: string | null
): SchedulerEvent[] {
  return events
    .filter((ev) => {
      if (excludeJobId && ev.id === excludeJobId) return false
      return dayKeyLocal(new Date(ev.scheduled_at)) === dateKey
    })
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
}

type TimeRange = { startMs: number; endMs: number; techId: string | null }

function eventTimeRange(event: SchedulerEvent): TimeRange {
  const startMs = new Date(event.scheduled_at).getTime()
  const endMs = startMs + Math.max(event.duration_minutes, 15) * 60_000
  return { startMs, endMs, techId: event.assigned_tech_id ?? null }
}

function proposedTimeRange(dateKey: string, timeValue: string, durationMinutes: number): TimeRange | null {
  const combined = combineDateAndTime(dateKey, timeValue)
  if (!isScheduleDateTimeValid(dateKey, timeValue)) return null
  const startMs = new Date(combined).getTime()
  return { startMs, endMs: startMs + Math.max(durationMinutes, 15) * 60_000, techId: null }
}

function rangesOverlap(a: TimeRange, b: TimeRange, assignedTechId: string | null): boolean {
  const aTech = assignedTechId?.trim() || null
  const bTech = b.techId
  if (aTech && bTech && aTech !== bTech) return false
  return a.startMs < b.endMs && b.startMs < a.endMs
}

/** Booked events that overlap the proposed slot (same tech or unassigned/global). */
export function findScheduleConflicts(
  events: SchedulerEvent[],
  dateKey: string,
  timeValue: string,
  durationMinutes: number,
  assignedTechId: string | null,
  excludeJobId?: string | null
): SchedulerEvent[] {
  const proposed = proposedTimeRange(dateKey, timeValue, durationMinutes)
  if (!proposed) return []
  const dayEvents = eventsOnScheduleDay(events, dateKey, excludeJobId)
  return dayEvents.filter((ev) => rangesOverlap(proposed, eventTimeRange(ev), assignedTechId))
}

/** First open slot on a day (optional starting time filter). */
export function suggestNextOpenTime(
  events: SchedulerEvent[],
  dateKey: string,
  durationMinutes: number,
  assignedTechId: string | null,
  excludeJobId?: string | null,
  startHour = 7,
  endHour = 19
): string | null {
  for (const slot of scheduleTimeSlotOptions(startHour, endHour)) {
    if (findScheduleConflicts(events, dateKey, slot.value, durationMinutes, assignedTechId, excludeJobId).length === 0) {
      return slot.value
    }
  }
  return null
}
