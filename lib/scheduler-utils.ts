// Helpers for parsing appointment times from receptionist intake fields.

/** Try to parse a structured ISO time from intake field values. */
export function parseScheduledAtFromFields(fields: Record<string, unknown>): string | null {
  const raw =
    fields.scheduled_at ??
    fields.preferred_time ??
    fields.time_slot ??
    fields.appointment_time ??
    fields.drop_off_time
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text) return null
  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}

/** Normalize a date-only or ISO string for API query params. */
export function parseIsoDateParam(raw: string | null | undefined): Date | null {
  const text = raw?.trim()
  if (!text) return null
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Start/end of calendar month in ISO for DB range queries. */
export function monthRangeUtc(year: number, monthIndex: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0))
  const to = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999))
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Calendar day key (YYYY-MM-DD) in local timezone. */
export function dayKeyLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Local midnight → next midnight as ISO bounds for a calendar day key. */
export function localDayRangeIso(dayKey: string): { fromIso: string; toIso: string } {
  const [y, m, d] = dayKey.split("-").map(Number)
  const from = new Date(y, m - 1, d, 0, 0, 0, 0)
  const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
  return { fromIso: from.toISOString(), toIso: to.toISOString() }
}

/** Hourly grid defaults for the owner scheduler day view. */
export const SCHEDULER_GRID_START_HOUR = 7
export const SCHEDULER_GRID_END_HOUR = 19
export const SCHEDULER_HOUR_ROW_PX = 64
/** Column width for mobile horizontal timeline (time on X axis). */
export const SCHEDULER_HOUR_COL_PX = 56
/** Row height for each technician lane on mobile timeline. */
export const SCHEDULER_TECH_ROW_PX = 52

/** Inclusive hour labels for the timeline (7 AM … 7 PM). */
export function schedulerHourSlots(): number[] {
  const slots: number[] = []
  for (let h = SCHEDULER_GRID_START_HOUR; h <= SCHEDULER_GRID_END_HOUR; h += 1) slots.push(h)
  return slots
}

export function formatHourLabel(hour24: number): string {
  const h = hour24 % 24
  const suffix = h >= 12 ? "PM" : "AM"
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${suffix}`
}

/** Build a local Date on `day` at `hour24:00` (optional minutes). */
export function dateAtLocalHour(day: Date, hour24: number, minutes = 0): Date {
  const d = new Date(day)
  d.setHours(hour24, minutes, 0, 0)
  return d
}

/** Value for `<input type="datetime-local">` in local timezone. */
export function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  const h = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${y}-${mo}-${da}T${h}:${mi}`
}

/** Value for `<input type="date">` from an ISO timestamp. */
export function scheduledDateInputFromIso(iso: string | null | undefined): string {
  if (!iso?.trim()) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, "0")
  const da = String(d.getDate()).padStart(2, "0")
  return `${y}-${mo}-${da}`
}

/** Value for `<input type="time">` from an ISO timestamp. */
export function scheduledTimeInputFromIso(iso: string | null | undefined): string {
  if (!iso?.trim()) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const h = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${h}:${mi}`
}

/** Merge separate date + time inputs into an ISO string (local wall clock). */
export function combineScheduledDateTimeLocal(date: string, time: string): string | null {
  const d = date.trim()
  const t = time.trim()
  if (!d || !t) return null
  const parsed = new Date(`${d}T${t}`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

/** Human-readable appointment date for overview cards. */
export function formatScheduledDateDisplay(iso: string | null | undefined): string {
  if (!iso?.trim()) return "Not scheduled"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Not scheduled"
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Human-readable appointment time for overview cards. */
export function formatScheduledTimeDisplay(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** Placement of an event block on the hourly grid (pixels from top of day column). */
export function schedulerEventPlacement(
  scheduledAtIso: string,
  durationMinutes: number,
  tentative: boolean
): { topPx: number; heightPx: number; start: Date } {
  const start = new Date(scheduledAtIso)
  let hour = start.getHours()
  let minute = start.getMinutes()
  if (tentative && hour === 0 && minute === 0) {
    hour = 9
    minute = 0
  }
  const minutesFromGridStart = (hour - SCHEDULER_GRID_START_HOUR) * 60 + minute
  const topPx = Math.max(0, (minutesFromGridStart / 60) * SCHEDULER_HOUR_ROW_PX)
  const duration = Math.max(durationMinutes, 15)
  const heightPx = Math.max(SCHEDULER_HOUR_ROW_PX / 2, (duration / 60) * SCHEDULER_HOUR_ROW_PX)
  return { topPx, heightPx, start }
}

/** Horizontal placement for mobile timeline (time left → right). */
export function schedulerEventHorizontalPlacement(
  scheduledAtIso: string,
  durationMinutes: number,
  tentative: boolean
): { leftPx: number; widthPx: number; start: Date } {
  const start = new Date(scheduledAtIso)
  let hour = start.getHours()
  let minute = start.getMinutes()
  if (tentative && hour === 0 && minute === 0) {
    hour = 9
    minute = 0
  }
  const minutesFromGridStart = (hour - SCHEDULER_GRID_START_HOUR) * 60 + minute
  const leftPx = Math.max(0, (minutesFromGridStart / 60) * SCHEDULER_HOUR_COL_PX)
  const duration = Math.max(durationMinutes, 15)
  const widthPx = Math.max(SCHEDULER_HOUR_COL_PX / 2, (duration / 60) * SCHEDULER_HOUR_COL_PX)
  return { leftPx, widthPx, start }
}

export const SCHEDULER_JOB_TYPES = [
  "Lockout",
  "Rekey",
  "Auto Detail",
  "Diagnostic / Repair",
  "Emergency dispatch",
  "Other",
] as const

export const SCHEDULER_DURATION_OPTIONS = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1.5 hours" },
  { minutes: 120, label: "2 hours" },
  { minutes: 180, label: "3 hours" },
] as const
