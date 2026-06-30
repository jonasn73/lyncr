// Helpers for the post-intake “Schedule this job” dialog (date + time fields).

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

/** Merge separate `<input type="date">` and `<input type="time">` into datetime-local shape. */
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
