// Daily call HUD metrics — formatting helpers shared by API + dashboard strip.

import { formatSecondsToClock, formatTalkHudMinutes } from "@/lib/telemetry-formatters"

/** Format seconds as m:ss for routing HUD talk pills (daily / weekly / monthly). */
export function formatTalkTime(totalSeconds: number): string {
  return formatTalkHudMinutes(totalSeconds)
}

/** Format seconds as m:ss (or h:mm:ss) for average talk HUD pills. */
export function formatAvgTalkTime(seconds: number): string {
  return formatSecondsToClock(seconds)
}

/** Format seconds as h:mm:ss when over an hour, otherwise m:ss (call history summaries). */
export function formatTalkDuration(seconds: number): string {
  return formatSecondsToClock(seconds)
}

export type DailyCallTelemetry = {
  daily_calls: number
  missed_calls: number
  avg_talk_seconds: number
  daily_talk_seconds: number
  weekly_talk_seconds: number
  monthly_talk_seconds: number
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

/** Browser-local calendar day — “Missed today” badge + HUD missed pill (resets at local midnight). */
export function isLocalCalendarToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** Rolling 24h window — routing HUD “today” stats (no midnight cliff for late-night calls). */
export function isWithinLast24Hours(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const ageMs = now.getTime() - d.getTime()
  return ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000
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

/** Local calendar month — matches monthly talk HUD + call history. */
export function isLocalCalendarThisMonth(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}
