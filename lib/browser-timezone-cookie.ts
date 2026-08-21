/**
 * Remember the shop owner’s timezone so SSR Activity/CRM times match the phone.
 */

import {
  DEFAULT_TELEMETRY_TIMEZONE,
  sanitizeIanaTimezone,
} from "@/lib/telemetry-timezone"

/** Cookie written on the device; the server reads it on the next refresh. */
export const TIMEZONE_COOKIE = "lyncr_tz"

/** Read a timezone cookie value (or fall back to US East). */
export function parseTimezoneCookie(cookieValue?: string | null): string {
  return sanitizeIanaTimezone(cookieValue) || DEFAULT_TELEMETRY_TIMEZONE
}

/** Tiny script: save IANA timezone before React runs (helps the next refresh). */
export const TIMEZONE_BOOTSTRAP_SCRIPT = `(function(){try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"${DEFAULT_TELEMETRY_TIMEZONE}";if(!/^[A-Za-z0-9_+\\/-]+$/.test(tz)||tz.length<3||tz.length>64)tz="${DEFAULT_TELEMETRY_TIMEZONE}";document.cookie="${TIMEZONE_COOKIE}="+encodeURIComponent(tz)+"; Path=/; Max-Age=31536000; SameSite=Lax";}catch(e){}})();`

/** Calendar YYYY-MM-DD in an IANA zone (stable for Today / Yesterday). */
export function calendarDayKeyInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: sanitizeIanaTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

/** “Today” / “Yesterday” / “Aug 20” for Activity rows — same on server and phone. */
export function formatListDateLabel(d: Date, timeZone?: string | null): string {
  const tz = sanitizeIanaTimezone(timeZone)
  const that = calendarDayKeyInZone(d, tz)
  const today = calendarDayKeyInZone(new Date(), tz)
  if (that === today) return "Today"
  const [y, m, day] = today.split("-").map((n) => Number(n))
  const todayUtcNoon = Date.UTC(y, m - 1, day, 12)
  const yest = new Date(todayUtcNoon - 86_400_000)
  const yestKey = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, "0")}-${String(
    yest.getUTCDate()
  ).padStart(2, "0")}`
  if (that === yestKey) return "Yesterday"
  return d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })
}

/** “3:44 PM” for Activity rows — same on server and phone. */
export function formatListTimeLabel(d: Date, timeZone?: string | null): string {
  return d.toLocaleTimeString("en-US", {
    timeZone: sanitizeIanaTimezone(timeZone),
    hour: "numeric",
    minute: "2-digit",
  })
}
