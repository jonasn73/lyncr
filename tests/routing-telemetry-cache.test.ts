import { describe, expect, it } from "vitest"
import {
  normalizeRoutingTelemetrySnapshot,
  type RoutingTelemetrySnapshot,
} from "@/lib/routing-telemetry-cache"
import { localDateTimePartsInZone } from "@/lib/schedule-blockouts"

describe("normalizeRoutingTelemetrySnapshot", () => {
  it("zeros weekly talk when the cached snapshot is from a prior week", () => {
    const stale: RoutingTelemetrySnapshot = {
      dailyCalls: 5,
      missedCalls: 2,
      dailyTalkSeconds: 900,
      weeklyTalkSeconds: 3490,
      monthlyTalkSeconds: 7800,
      bookingRatePercent: 42,
      bookedJobsCount: 3,
      uniqueCallersCount: 7,
      avgDispatchSpeedMinutes: 2.4,
      rescueRevenueCents: 85000,
      ownerUserId: "user-1",
      weekPeriodKey: "2026-06-29",
      monthPeriodKey: "2026-07",
      localDayPeriodKey: "2026-07-07",
    }
    const now = new Date("2026-07-07T14:00:00")
    const normalized = normalizeRoutingTelemetrySnapshot(stale, now)
    expect(normalized.weeklyTalkSeconds).toBe(0)
    expect(normalized.monthlyTalkSeconds).toBe(7800)
    expect(normalized.missedCalls).toBe(2)
    expect(normalized.dailyCalls).toBe(5)
    expect(normalized.rescueRevenueCents).toBe(85000)
    expect(normalized.weekPeriodKey).toBe("2026-07-06")
  })

  it("zeros day-scoped strip metrics when the local day rolled over", () => {
    const stale: RoutingTelemetrySnapshot = {
      dailyCalls: 3,
      missedCalls: 4,
      dailyTalkSeconds: 600,
      weeklyTalkSeconds: 1200,
      monthlyTalkSeconds: 9000,
      bookingRatePercent: 10,
      bookedJobsCount: 1,
      uniqueCallersCount: 10,
      avgDispatchSpeedMinutes: 2.4,
      rescueRevenueCents: 46000,
      ownerUserId: "user-1",
      weekPeriodKey: "2026-07-06",
      monthPeriodKey: "2026-06",
      localDayPeriodKey: "2026-07-06",
    }
    const now = new Date("2026-07-07T09:00:00")
    const normalized = normalizeRoutingTelemetrySnapshot(stale, now)
    expect(normalized.monthlyTalkSeconds).toBe(0)
    expect(normalized.missedCalls).toBe(0)
    expect(normalized.dailyCalls).toBe(0)
    expect(normalized.dailyTalkSeconds).toBe(0)
    expect(normalized.bookingRatePercent).toBe(0)
    expect(normalized.bookedJobsCount).toBe(0)
    expect(normalized.uniqueCallersCount).toBe(0)
    expect(normalized.avgDispatchSpeedMinutes).toBeNull()
    expect(normalized.rescueRevenueCents).toBe(0)
    expect(normalized.weeklyTalkSeconds).toBe(1200)
  })

  it("keeps Eastern rescue and booked jobs after UTC midnight (8pm Louisville)", () => {
    const tz = "America/New_York"
    const stale: RoutingTelemetrySnapshot = {
      dailyCalls: 5,
      missedCalls: 0,
      dailyTalkSeconds: 0,
      weeklyTalkSeconds: 0,
      monthlyTalkSeconds: 0,
      bookingRatePercent: 17,
      bookedJobsCount: 1,
      uniqueCallersCount: 6,
      avgDispatchSpeedMinutes: null,
      rescueRevenueCents: 17500,
      ownerUserId: "user-1",
      localDayPeriodKey: "2026-08-19",
      timeZone: tz,
    }
    const utcTomorrow = new Date("2026-08-20T02:00:00.000Z")
    const normalized = normalizeRoutingTelemetrySnapshot(stale, utcTomorrow)
    expect(normalized.rescueRevenueCents).toBe(17500)
    expect(normalized.bookedJobsCount).toBe(1)
    expect(normalized.bookingRatePercent).toBe(17)
    expect(normalized.localDayPeriodKey).toBe(
      localDateTimePartsInZone(utcTomorrow, tz).dateKey
    )
  })
})
