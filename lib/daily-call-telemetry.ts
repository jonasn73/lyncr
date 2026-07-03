// Daily call HUD metrics — formatting helpers shared by API + dashboard strip.

/** Format seconds as mm:ss for short HUD pills (daily talk). */
export function formatTalkTime(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`
}

/** Format seconds as mm:ss for short HUD pills. */
export function formatAvgTalkTime(seconds: number): string {
  return formatTalkDuration(seconds)
}

/** Format seconds as h:mm:ss when over an hour, otherwise m:ss. */
export function formatTalkDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`
}

export type DailyCallTelemetry = {
  daily_calls: number
  missed_calls: number
  avg_talk_seconds: number
  daily_talk_seconds: number
  weekly_talk_seconds: number
  owner_user_id: string
}

/** UTC calendar day — legacy helper; prefer isLocalCalendarToday for owner-facing "today". */
export function isUtcToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

/** Browser-local calendar day — matches “Today, 6:32 AM” labels in the activity list. */
export function isLocalCalendarToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** Local calendar week (Mon–Sun) — matches weekly talk breakdown in call history. */
export function isLocalCalendarThisWeek(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const start = new Date(now)
  const weekday = start.getDay()
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - daysFromMonday)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return d >= start && d < end
}
