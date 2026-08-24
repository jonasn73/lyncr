// Calendar-day boundaries in a business's own timezone.
//
// "Today" measured at UTC midnight is 8pm Eastern, so a Louisville shop's evening calls
// were being banked to the next day — a receptionist finishing a 6–10pm shift watched
// their own day reset in front of them. The hold-queue stats already solve this in SQL
// (`date_trunc('day', timezone(tz, …))`); this is the same idea for code paths that need
// an explicit instant range instead.

import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds.
 * Derived by formatting the instant into the zone and reading the wall-clock back.
 */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value
  }
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some locales render midnight as hour 24 — normalise before arithmetic.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  )
  // Compare against a whole second: the formatted wall clock has no milliseconds, so
  // subtracting the raw instant would fold `at`'s milliseconds into the offset and push
  // the computed midnight off the second boundary.
  const atWholeSecond = Math.floor(at.getTime() / 1000) * 1000
  return wallClockAsUtc - atWholeSecond
}

/** The instant at which the given zone's calendar day, `dayOffset` days from now, begins. */
function zonedMidnight(timeZone: string, now: Date, dayOffset: number): Date {
  const offset = zoneOffsetMs(timeZone, now)
  const local = new Date(now.getTime() + offset)
  const localMidnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + dayOffset
  )
  // The offset can differ on the target day (DST) — recheck at the candidate instant.
  const candidate = localMidnightAsUtc - offset
  const offsetThere = zoneOffsetMs(timeZone, new Date(candidate))
  return new Date(offsetThere === offset ? candidate : localMidnightAsUtc - offsetThere)
}

/**
 * Start (inclusive) and end (exclusive) instants of the current calendar day in `timeZone`.
 * Falls back to the default business timezone when the zone is missing or unusable.
 */
export function zonedDayRangeIso(
  timeZone: string | null | undefined,
  now: Date = new Date()
): { start: string; end: string } {
  const tz = sanitizeIanaTimezone(timeZone)
  try {
    return {
      start: zonedMidnight(tz, now, 0).toISOString(),
      end: zonedMidnight(tz, now, 1).toISOString(),
    }
  } catch {
    // An unknown-but-well-formed zone reaches Intl and throws — never lose the day range.
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return {
      start: new Date(utcMidnight).toISOString(),
      end: new Date(utcMidnight + 24 * 60 * 60 * 1000).toISOString(),
    }
  }
}
