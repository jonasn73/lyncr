import { describe, expect, it } from "vitest"
import { isLocalCalendarToday, isLocalCalendarThisWeek, isUtcToday } from "@/lib/daily-call-telemetry"

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

describe("isLocalCalendarThisWeek", () => {
  it("includes calls from Monday through Sunday in the local week", () => {
    const now = new Date("2026-07-02T14:00:00")
    expect(isLocalCalendarThisWeek("2026-06-29T10:00:00", now)).toBe(true)
    expect(isLocalCalendarThisWeek("2026-06-22T10:00:00", now)).toBe(false)
  })
})
