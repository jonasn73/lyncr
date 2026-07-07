import { describe, expect, it } from "vitest"
import {
  isLocalCalendarToday,
  isLocalCalendarThisMonth,
  isLocalCalendarThisWeek,
  isLocalCalendarThisWeekInMonth,
  isUtcToday,
  isWithinLast24Hours,
  localWeekStartDate,
  telemetryLocalDayPeriodKey,
  telemetryMonthPeriodKey,
  telemetryWeekPeriodKey,
} from "@/lib/daily-call-telemetry"

describe("isUtcToday", () => {
  it("matches Neon UTC day boundaries used by HUD telemetry", () => {
    const now = new Date("2026-07-01T05:08:27.015Z")
    expect(isUtcToday("2026-07-01T03:33:23.812Z", now)).toBe(true)
    expect(isUtcToday("2026-06-30T23:57:00.310Z", now)).toBe(false)
  })
})

describe("isLocalCalendarToday", () => {
  it("uses the browser-local calendar day for activity missed lists", () => {
    const now = new Date("2026-07-02T14:00:00")
    expect(isLocalCalendarToday("2026-07-02T06:32:00", now)).toBe(true)
    expect(isLocalCalendarToday("2026-07-01T23:59:00", now)).toBe(false)
  })
})

describe("isWithinLast24Hours", () => {
  it("includes calls from the last 24 hours", () => {
    const now = new Date("2026-07-03T04:13:00")
    expect(isWithinLast24Hours("2026-07-03T03:53:00", now)).toBe(true)
    expect(isWithinLast24Hours("2026-07-02T04:12:00", now)).toBe(false)
  })
})

describe("isLocalCalendarThisWeek", () => {
  it("includes calls from Monday through Sunday in the local week", () => {
    const now = new Date("2026-07-02T14:00:00")
    expect(isLocalCalendarThisWeek("2026-06-29T10:00:00", now)).toBe(true)
    expect(isLocalCalendarThisWeek("2026-06-22T10:00:00", now)).toBe(false)
  })
})

describe("isLocalCalendarThisMonth", () => {
  it("includes calls from the same local calendar month", () => {
    const now = new Date("2026-07-15T14:00:00")
    expect(isLocalCalendarThisMonth("2026-07-01T10:00:00", now)).toBe(true)
    expect(isLocalCalendarThisMonth("2026-06-30T23:59:00", now)).toBe(false)
  })
})

describe("isLocalCalendarThisWeekInMonth", () => {
  it("excludes prior-month days that still fall in the current ISO week", () => {
    const now = new Date("2026-07-04T17:00:00")
    expect(isLocalCalendarThisWeek("2026-06-30T10:00:00", now)).toBe(true)
    expect(isLocalCalendarThisWeekInMonth("2026-06-30T10:00:00", now)).toBe(false)
    expect(isLocalCalendarThisWeekInMonth("2026-07-04T10:00:00", now)).toBe(true)
  })
})

describe("telemetry period keys", () => {
  it("uses Monday as the week boundary for weekly talk reset", () => {
    const tuesday = new Date("2026-07-07T14:00:00")
    expect(localWeekStartDate(tuesday).toISOString().slice(0, 10)).toBe("2026-07-06")
    expect(telemetryWeekPeriodKey(tuesday)).toBe("2026-07-06")
    expect(telemetryWeekPeriodKey(new Date("2026-07-06T00:30:00"))).toBe("2026-07-06")
    expect(telemetryWeekPeriodKey(new Date("2026-07-05T23:59:00"))).toBe("2026-06-29")
  })

  it("formats month and local-day keys for cache invalidation", () => {
    const now = new Date("2026-07-04T17:00:00")
    expect(telemetryMonthPeriodKey(now)).toBe("2026-07")
    expect(telemetryLocalDayPeriodKey(now)).toBe("2026-07-04")
  })
})
