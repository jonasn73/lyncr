// Formatters for Lines dashboard performance KPIs (booking / dispatch / rescue).

/** Booking rate as a whole-number percent string, e.g. "78%" or "0%" when empty. */
export function formatBookingRatePercent(rate: number | null | undefined): string {
  // Treat missing/invalid as zero so the strip never shows NaN.
  const n = Number(rate ?? 0)
  // No signal yet — still render 0% (muted style is handled separately).
  if (!Number.isFinite(n) || n <= 0) return "0%"
  // Clamp to 0–100 and round to a whole percent for the HUD.
  return `${Math.min(100, Math.max(0, Math.round(n)))}%`
}

/**
 * Fraction under Booking % — booked jobs ÷ unique callers, e.g. "1/18".
 * Returns null when there is nothing useful to show (no callers yet).
 */
export function formatBookingJobsFraction(
  bookedJobs: number | null | undefined,
  uniqueCallers: number | null | undefined
): string | null {
  // Coerce to non-negative integers for display.
  const jobs = Math.max(0, Math.floor(Number(bookedJobs ?? 0)))
  const callers = Math.max(0, Math.floor(Number(uniqueCallers ?? 0)))
  // Hide the fraction until we have at least one unique caller today.
  if (!Number.isFinite(callers) || callers <= 0) return null
  // Always show jobs/callers so Key Squad can see the raw booking math.
  return `${jobs}/${callers}`
}

/** True when booking rate has no real signal yet (show muted style). */
export function isBookingRateEmpty(rate: number | null | undefined): boolean {
  // Same zero/invalid check as the percent formatter.
  const n = Number(rate ?? 0)
  return !Number.isFinite(n) || n <= 0
}

/** Avg dispatch speed in minutes for today, e.g. "2.4 min". */
export function formatAvgDispatchSpeedMinutes(minutes: number | null | undefined): string {
  // Null / bad values → em dash (no samples today).
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—"
  // One decimal under 10 min; whole minutes above that.
  const rounded = minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes)
  return `${rounded} min`
}

/** Today's rescue opportunity dollars from cents, e.g. "$850". Null = still loading (show em dash). */
export function formatRescueRevenueDollars(cents: number | null | undefined): string {
  // Null means baseline not ready yet — do not flash $0.
  if (cents == null) return "—"
  const n = Number(cents)
  // Zero or invalid → explicit $0 once loaded.
  if (!Number.isFinite(n) || n <= 0) return "$0"
  // Cents → whole dollars with thousands separators.
  return `$${Math.round(n / 100).toLocaleString("en-US")}`
}
