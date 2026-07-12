// Formatters for Lines dashboard performance KPIs (booking / dispatch / rescue).

/** Booking rate as a whole-number percent string, e.g. "78%". */
export function formatBookingRatePercent(rate: number | null | undefined): string {
  const n = Number(rate ?? 0)
  if (!Number.isFinite(n) || n <= 0) return "—"
  return `${Math.min(100, Math.max(0, Math.round(n)))}%`
}

/** Avg dispatch speed in minutes, e.g. "2.4 min". */
export function formatAvgDispatchSpeedMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—"
  const rounded = minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes)
  return `${rounded} min`
}

/** Rescue queue dollars from cents, e.g. "$850". */
export function formatRescueRevenueDollars(cents: number | null | undefined): string {
  const n = Number(cents ?? 0)
  if (!Number.isFinite(n) || n <= 0) return "$0"
  return `$${Math.round(n / 100).toLocaleString("en-US")}`
}
