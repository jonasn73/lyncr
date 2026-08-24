// Billing-cycle window arithmetic.
//
// The stored window on an onboarding profile is the Stripe subscription period captured
// when the subscription was created. Nothing ever advanced it, so once that period closed
// the window was returned verbatim forever and every later call fell outside it — which is
// how a receptionist's pay ledger read $0.00 for months while they kept answering calls.
//
// Rolling forward keeps the anchor day (an 18th-of-the-month cycle stays on the 18th)
// rather than restarting from "now", so pay periods stay aligned with the subscription.

/** Guard against a corrupt stored window spinning the roll-forward loop. */
const MAX_PERIODS_TO_ROLL = 600

export type BillingCycleWindow = { start: string; end: string }

/** Last representable day of a UTC month, so a 31st anchor does not overflow into the next. */
function lastDayOfUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Add whole months in UTC, clamping the day so Jan 31 + 1 month is Feb 28, not Mar 3. */
export function addUtcMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const monthIndex = date.getUTCMonth() + months
  const targetYear = year + Math.floor(monthIndex / 12)
  const targetMonth = ((monthIndex % 12) + 12) % 12
  const day = Math.min(date.getUTCDate(), lastDayOfUtcMonth(targetYear, targetMonth))
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  )
}

/** Whole months spanned by the window, 0 for sub-month cycles (weekly, 10-day, …). */
function windowMonthSpan(start: Date, end: Date): number {
  const span =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  return span > 0 ? span : 0
}

/**
 * Advance an expired window by whole periods until it contains `now`.
 *
 * A window that has not closed yet is returned untouched — this only repairs stale ones.
 * Returns null when the input is unusable, so callers can fall back to a calendar month.
 */
export function rollBillingCycleWindowForward(
  startIso: string,
  endIso: string,
  now: Date = new Date()
): BillingCycleWindow | null {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null
  if (end.getTime() <= start.getTime()) return null

  // Still open (or opens in the future) — nothing to repair.
  if (end.getTime() > now.getTime()) {
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const months = windowMonthSpan(start, end)

  if (months > 0) {
    // Jump most of the way in one step, then step period-by-period to land exactly.
    const elapsedMonths =
      (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth())
    const jump = Math.max(0, Math.floor(elapsedMonths / months) * months)
    let nextStart = addUtcMonths(start, jump)
    let nextEnd = addUtcMonths(end, jump)
    let guard = 0
    while (nextEnd.getTime() <= now.getTime() && guard < MAX_PERIODS_TO_ROLL) {
      nextStart = addUtcMonths(nextStart, months)
      nextEnd = addUtcMonths(nextEnd, months)
      guard += 1
    }
    // Overshot (the jump can land past `now` on clamped months) — walk back.
    while (nextStart.getTime() > now.getTime() && guard < MAX_PERIODS_TO_ROLL) {
      nextStart = addUtcMonths(nextStart, -months)
      nextEnd = addUtcMonths(nextEnd, -months)
      guard += 1
    }
    if (nextEnd.getTime() <= now.getTime()) return null
    return { start: nextStart.toISOString(), end: nextEnd.toISOString() }
  }

  // Sub-month cycle — advance by the exact duration.
  const durationMs = end.getTime() - start.getTime()
  const periodsBehind = Math.floor((now.getTime() - start.getTime()) / durationMs)
  if (!Number.isFinite(periodsBehind) || periodsBehind > MAX_PERIODS_TO_ROLL) return null
  const shifted = periodsBehind * durationMs
  return {
    start: new Date(start.getTime() + shifted).toISOString(),
    end: new Date(end.getTime() + shifted).toISOString(),
  }
}
