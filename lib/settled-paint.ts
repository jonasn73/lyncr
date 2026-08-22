/**
 * App-wide settled-paint helpers — stop confident zeros / empties / partial lists
 * from flashing before live data. Safe for server + client (no React hooks here).
 *
 * Hooks live in `lib/hooks/use-held-list.ts`.
 */

import {
  calendarDayKeyInZone,
  formatListTimeLabel,
  resolveOwnerTimezone,
} from "@/lib/browser-timezone-cookie"

/** True when this surface may paint counts / empty copy / KPI zeros. */
export function isSurfaceSettled(opts: {
  /** Bootstrap / first successful paint for this pane. */
  settled?: boolean
  loading?: boolean
  validating?: boolean
}): boolean {
  const settled = opts.settled !== false
  if (!settled) return false
  if (opts.loading) return false
  if (opts.validating) return false
  return true
}

/**
 * Count / subtitle label — blank until settled so “0 active” never flashes.
 * When settled, returns the formatted string (including real zeros).
 * Optional paintHint: if live count is 0 but cookie says we had rows, stay blank.
 */
export function settledCountText(
  pending: boolean,
  count: number,
  format: (n: number) => string,
  paintHint?: number | null
): string {
  if (pending) return "\u00a0"
  if (count === 0 && paintHint != null && paintHint > 0) return "\u00a0"
  return format(count)
}

/**
 * List stamp for Activity / Messages / CRM — always pass an explicit IANA zone
 * from paint seeds when available so SSR matches the phone.
 */
export function formatOwnerListTime(
  iso: string,
  timeZone?: string | null
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const tz = (timeZone && timeZone.trim()) || resolveOwnerTimezone()
  if (calendarDayKeyInZone(d, tz) === calendarDayKeyInZone(new Date(), tz)) {
    return formatListTimeLabel(d, tz)
  }
  return d.toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  })
}

/**
 * Prefer street `location` over city `neighborhood` for paint + cards.
 * Avoids “Louisville” → full address flips.
 */
export function resolveStablePlaceLine(opts: {
  location?: string | null
  neighborhood?: string | null
  region?: string | null
}): string {
  const loc = (opts.location ?? "").trim()
  const neigh = (opts.neighborhood ?? "").trim()
  let primary = ""
  if (loc && neigh) {
    if (loc === neigh || loc.includes(neigh) || neigh.includes(loc)) {
      primary = loc.length >= neigh.length ? loc : neigh
    } else {
      primary = loc
    }
  } else {
    primary = loc || neigh
  }
  const region = (opts.region ?? "").trim()
  if (region && primary && primary !== region && !primary.includes(region)) {
    return `${primary}, ${region}`
  }
  return primary
}
