// Owner's recurring weekly available hours — feeds the sync-presence cron so
// Presence auto-flips AVAILABLE/CLOSED even when nobody remembers to toggle it.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { localDateTimePartsInZone, parseHhMmToMinutes } from "@/lib/schedule-blockouts"

export type WeeklyHoursDay = {
  /** 0 = Sunday … 6 = Saturday, matching Intl weekday order. */
  dayOfWeek: number
  enabled: boolean
  startTime: string // HH:mm
  endTime: string // HH:mm
}

export type AccountWeeklyHours = {
  /** When false, presence is never auto-closed by the schedule (cron leaves it alone). */
  scheduleEnabled: boolean
  timezone: string
  /** Always 7 entries, ordered Sunday (0) through Saturday (6). */
  days: WeeklyHoursDay[]
}

const DEFAULT_TIMEZONE = "America/New_York"

function defaultDays(): WeeklyHoursDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    // Mon–Fri on by default; Sat/Sun off. Owner tunes from there.
    enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
    startTime: "09:00",
    endTime: "17:00",
  }))
}

export const DEFAULT_ACCOUNT_WEEKLY_HOURS: AccountWeeklyHours = {
  scheduleEnabled: false,
  timezone: DEFAULT_TIMEZONE,
  days: defaultDays(),
}

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingWeeklyHoursSchema(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("account_weekly_hours") ||
    msg.includes("hours_schedule_enabled") ||
    msg.includes("hours_timezone")
  )
}

function normalizeTimeString(raw: unknown, fallback: string): string {
  const minutes = parseHhMmToMinutes(typeof raw === "string" ? raw : null)
  if (minutes == null) return fallback
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0")
  const mm = String(minutes % 60).padStart(2, "0")
  return `${hh}:${mm}`
}

function normalizeTimezone(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : ""
  if (!s) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s })
    return s
  } catch {
    return DEFAULT_TIMEZONE
  }
}

type WeeklyHoursRow = {
  day_of_week: number | string
  enabled: boolean
  start_time: string
  end_time: string
}

/** Load an owner's weekly hours (creates the default schedule row set when missing). */
export async function getAccountWeeklyHours(ownerUserId: string): Promise<AccountWeeklyHours> {
  if (!ownerUserId.trim()) return { ...DEFAULT_ACCOUNT_WEEKLY_HOURS, days: defaultDays() }
  const sql = sqlClient()
  try {
    const [settingsRows, dayRows] = await Promise.all([
      sql`
        SELECT hours_schedule_enabled, hours_timezone
        FROM account_settings
        WHERE user_id = ${ownerUserId}
        LIMIT 1
      `,
      sql`
        SELECT day_of_week, enabled, start_time, end_time
        FROM account_weekly_hours
        WHERE user_id = ${ownerUserId}
      `,
    ])
    const settings = settingsRows[0] as
      | { hours_schedule_enabled?: boolean; hours_timezone?: string }
      | undefined
    const byDay = new Map<number, WeeklyHoursDay>()
    for (const row of dayRows as WeeklyHoursRow[]) {
      const dayOfWeek = Number(row.day_of_week)
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue
      byDay.set(dayOfWeek, {
        dayOfWeek,
        enabled: row.enabled === true,
        startTime: normalizeTimeString(row.start_time, "09:00"),
        endTime: normalizeTimeString(row.end_time, "17:00"),
      })
    }
    const fallback = defaultDays()
    const days = fallback.map((d) => byDay.get(d.dayOfWeek) ?? d)
    return {
      scheduleEnabled: settings?.hours_schedule_enabled === true,
      timezone: normalizeTimezone(settings?.hours_timezone),
      days,
    }
  } catch (e) {
    if (isMissingWeeklyHoursSchema(e)) {
      console.warn("[account-weekly-hours] schema missing — run scripts/161-account-weekly-hours.sql")
      return { ...DEFAULT_ACCOUNT_WEEKLY_HOURS, days: defaultDays() }
    }
    throw e
  }
}

export type SetAccountWeeklyHoursParams = {
  ownerUserId: string
  scheduleEnabled: boolean
  timezone: string
  days: WeeklyHoursDay[]
}

/** Save the owner's weekly schedule + timezone in one transaction. */
export async function setAccountWeeklyHours(
  params: SetAccountWeeklyHoursParams
): Promise<AccountWeeklyHours> {
  const timezone = normalizeTimezone(params.timezone)
  const byDay = new Map(params.days.map((d) => [d.dayOfWeek, d]))
  const days = defaultDays().map((fallback) => {
    const d = byDay.get(fallback.dayOfWeek)
    if (!d) return fallback
    const startTime = normalizeTimeString(d.startTime, fallback.startTime)
    const endTime = normalizeTimeString(d.endTime, fallback.endTime)
    return {
      dayOfWeek: fallback.dayOfWeek,
      enabled: d.enabled === true,
      startTime,
      endTime,
    }
  })

  const sql = sqlClient()
  try {
    await sql.transaction([
      sql`
        INSERT INTO account_settings (user_id, presence_status, presence_closed_manual, hours_schedule_enabled, hours_timezone, updated_at)
        VALUES (${params.ownerUserId}, 'AVAILABLE', false, ${params.scheduleEnabled === true}, ${timezone}, now())
        ON CONFLICT (user_id) DO UPDATE SET
          hours_schedule_enabled = EXCLUDED.hours_schedule_enabled,
          hours_timezone = EXCLUDED.hours_timezone,
          updated_at = now()
      `,
      ...days.map(
        (d) => sql`
          INSERT INTO account_weekly_hours (user_id, day_of_week, enabled, start_time, end_time)
          VALUES (${params.ownerUserId}, ${d.dayOfWeek}, ${d.enabled}, ${d.startTime}, ${d.endTime})
          ON CONFLICT (user_id, day_of_week) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time
        `
      ),
    ])
    return getAccountWeeklyHours(params.ownerUserId)
  } catch (e) {
    if (isMissingWeeklyHoursSchema(e)) {
      const err = new Error(
        "Weekly hours schema missing — run scripts/161-account-weekly-hours.sql in Neon."
      )
      ;(err as Error & { code?: string }).code = "ACCOUNT_HOURS_MIGRATION_REQUIRED"
      throw err
    }
    throw e
  }
}

/** Weekday (0 = Sunday … 6 = Saturday) local to an IANA timezone. */
export function localWeekdayInZone(now: Date, timeZone: string): number {
  try {
    const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now)
    const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const idx = order.indexOf(label)
    return idx >= 0 ? idx : now.getDay()
  } catch {
    return now.getDay()
  }
}

/**
 * True when `now` falls inside the owner's scheduled hours.
 * When the schedule is off, this is always true (no auto-close restriction).
 */
export function isWithinScheduledHours(
  hours: AccountWeeklyHours,
  now: Date = new Date()
): boolean {
  if (!hours.scheduleEnabled) return true
  const weekday = localWeekdayInZone(now, hours.timezone)
  const day = hours.days.find((d) => d.dayOfWeek === weekday)
  if (!day || !day.enabled) return false
  const start = parseHhMmToMinutes(day.startTime)
  const end = parseHhMmToMinutes(day.endTime)
  if (start == null || end == null) return false
  const { minutes } = localDateTimePartsInZone(now, hours.timezone)
  return minutes >= start && minutes < end
}
