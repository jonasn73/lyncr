import { describe, expect, it } from "vitest"
import { zonedDayRangeIso } from "@/lib/zoned-day"

describe("zoned day range", () => {
  it("keeps a Louisville evening on the same day", () => {
    // 9pm Eastern on Aug 24 is already Aug 25 in UTC. The receptionist is still working
    // Monday, so the call must bank to Monday.
    const evening = new Date("2026-08-25T01:00:00.000Z") // 21:00 Aug 24 EDT
    const { start, end } = zonedDayRangeIso("America/New_York", evening)
    expect(start).toBe("2026-08-24T04:00:00.000Z") // midnight EDT
    expect(end).toBe("2026-08-25T04:00:00.000Z")
    expect(new Date(start).getTime()).toBeLessThanOrEqual(evening.getTime())
    expect(new Date(end).getTime()).toBeGreaterThan(evening.getTime())
  })

  it("differs from the UTC day exactly when the old code was wrong", () => {
    const evening = new Date("2026-08-25T01:00:00.000Z")
    const utcMidnight = new Date(
      Date.UTC(evening.getUTCFullYear(), evening.getUTCMonth(), evening.getUTCDate())
    ).toISOString()
    // The old implementation would have started "today" here — a day late.
    expect(utcMidnight).toBe("2026-08-25T00:00:00.000Z")
    expect(zonedDayRangeIso("America/New_York", evening).start).not.toBe(utcMidnight)
  })

  it("uses standard time offset in winter", () => {
    // EST is UTC-5, so midnight is 05:00Z rather than 04:00Z.
    const winter = new Date("2026-01-15T18:00:00.000Z")
    expect(zonedDayRangeIso("America/New_York", winter).start).toBe("2026-01-15T05:00:00.000Z")
  })

  it("produces a 23-hour day when DST springs forward", () => {
    // 2026-03-08 is the US spring-forward date.
    const springForward = new Date("2026-03-08T18:00:00.000Z")
    const { start, end } = zonedDayRangeIso("America/New_York", springForward)
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
    expect(hours).toBe(23)
  })

  it("produces a 25-hour day when DST falls back", () => {
    // 2026-11-01 is the US fall-back date.
    const fallBack = new Date("2026-11-01T18:00:00.000Z")
    const { start, end } = zonedDayRangeIso("America/New_York", fallBack)
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
    expect(hours).toBe(25)
  })

  it("lands exactly on midnight regardless of the current instant", () => {
    // A boundary carrying the caller's milliseconds can drop or double-count a call that
    // lands in that sub-second sliver.
    const odd = new Date("2026-08-24T16:43:00.197Z")
    const { start, end } = zonedDayRangeIso("America/New_York", odd)
    expect(start).toBe("2026-08-24T04:00:00.000Z")
    expect(end).toBe("2026-08-25T04:00:00.000Z")
    expect(new Date(start).getUTCMilliseconds()).toBe(0)
    expect(new Date(start).getUTCSeconds()).toBe(0)
  })

  it("falls back to the default business timezone when none is supplied", () => {
    const at = new Date("2026-08-25T01:00:00.000Z")
    expect(zonedDayRangeIso(null, at)).toEqual(zonedDayRangeIso("America/New_York", at))
  })

  it("always returns a range that contains the instant", () => {
    for (const tz of ["America/Chicago", "America/Los_Angeles", "UTC", "Europe/London"]) {
      const at = new Date("2026-08-25T01:00:00.000Z")
      const { start, end } = zonedDayRangeIso(tz, at)
      expect(new Date(start).getTime()).toBeLessThanOrEqual(at.getTime())
      expect(new Date(end).getTime()).toBeGreaterThan(at.getTime())
    }
  })
})
