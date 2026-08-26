import { describe, expect, it } from "vitest"
import { splitIntoWorkweeks } from "@/lib/compensation/calculate"

/**
 * Mirrors lastClosedWorkweek in app/api/cron/apply-wage-floor/route.ts.
 *
 * Duplicated rather than exported from the route, because importing a Next route
 * handler into a unit test drags the whole request pipeline in with it.
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
function lastClosedWorkweek(now: Date, weekStartDay = 0) {
  const daysSinceStart = (now.getUTCDay() - weekStartDay + 7) % 7
  const thisWeekStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceStart
  )
  return {
    startIso: new Date(thisWeekStart - WEEK_MS).toISOString(),
    endIso: new Date(thisWeekStart).toISOString(),
  }
}

describe("which week the sweep settles", () => {
  it("settles the week that just closed, not the one running", () => {
    // Monday 2026-08-24. The week that closed ran Sun 16th to Sun 23rd.
    const week = lastClosedWorkweek(new Date("2026-08-24T16:00:00.000Z"))
    expect(week.startIso).toBe("2026-08-16T00:00:00.000Z")
    expect(week.endIso).toBe("2026-08-23T00:00:00.000Z")
  })

  it("never reaches into the current week", () => {
    // Calls and shifts are still landing in it; judging it now would underpay.
    const now = new Date("2026-08-26T16:00:00.000Z")
    const week = lastClosedWorkweek(now)
    expect(Date.parse(week.endIso)).toBeLessThan(now.getTime())
  })

  it("always covers exactly seven days", () => {
    for (const day of ["2026-08-23", "2026-08-24", "2026-08-27", "2026-08-29"]) {
      const week = lastClosedWorkweek(new Date(`${day}T16:00:00.000Z`))
      expect(Date.parse(week.endIso) - Date.parse(week.startIso)).toBe(WEEK_MS)
    }
  })

  it("lines up with how the floor splits a period", () => {
    // The sweep and applyWageFloorForPeriod must agree on where a week starts, or a
    // week gets settled twice under two different source ids.
    const week = lastClosedWorkweek(new Date("2026-08-24T16:00:00.000Z"))
    const split = splitIntoWorkweeks(week.startIso, week.endIso)
    expect(split).toHaveLength(1)
    expect(split[0].startIso).toBe(week.startIso)
    expect(split[0].endIso).toBe(week.endIso)
  })

  it("honors an employer whose week starts on Monday", () => {
    // Wednesday 2026-08-26 with a Monday boundary → the week of Mon 17th to Mon 24th.
    const week = lastClosedWorkweek(new Date("2026-08-26T16:00:00.000Z"), 1)
    expect(week.startIso).toBe("2026-08-17T00:00:00.000Z")
    expect(week.endIso).toBe("2026-08-24T00:00:00.000Z")
  })
})
