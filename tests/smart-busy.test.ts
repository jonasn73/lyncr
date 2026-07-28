import { describe, expect, it } from "vitest"
import {
  computeCapacityLoad,
  formatSmartBusyCapacitySummary,
  isAtCapacity,
  shouldAutoEngageBusy,
  shouldAutoRevertBusy,
  shouldRecommendBusy,
} from "@/lib/smart-busy"

describe("smart busy", () => {
  it("loads capacity from confirmed jobs + pool", () => {
    expect(computeCapacityLoad({ confirmedJobsToday: 3, poolCount: 2 })).toBe(5)
    expect(computeCapacityLoad({ confirmedJobsToday: -1, poolCount: 2 })).toBe(2)
  })

  it("detects over-threshold capacity", () => {
    expect(isAtCapacity(6, 5)).toBe(true)
    expect(isAtCapacity(5, 5)).toBe(false)
    expect(isAtCapacity(0, 5)).toBe(false)
  })

  it("recommends Busy only when Available and at capacity", () => {
    expect(shouldRecommendBusy({ atCapacity: true, presenceStatus: "AVAILABLE" })).toBe(true)
    expect(shouldRecommendBusy({ atCapacity: true, presenceStatus: "ON_JOB" })).toBe(false)
    expect(shouldRecommendBusy({ atCapacity: false, presenceStatus: "AVAILABLE" })).toBe(false)
  })

  it("auto-engages only with Smart Busy on + Available + at capacity", () => {
    expect(
      shouldAutoEngageBusy({
        smartBusyEnabled: true,
        atCapacity: true,
        presenceStatus: "AVAILABLE",
      })
    ).toBe(true)
    expect(
      shouldAutoEngageBusy({
        smartBusyEnabled: false,
        atCapacity: true,
        presenceStatus: "AVAILABLE",
      })
    ).toBe(false)
    expect(
      shouldAutoEngageBusy({
        smartBusyEnabled: true,
        atCapacity: true,
        presenceStatus: "ON_JOB",
      })
    ).toBe(false)
    expect(
      shouldAutoEngageBusy({
        smartBusyEnabled: true,
        atCapacity: true,
        presenceStatus: "AVAILABLE",
        suppressed: true,
      })
    ).toBe(false)
  })

  it("auto-reverts only when Smart Busy engaged and capacity clears", () => {
    expect(
      shouldAutoRevertBusy({
        smartBusyEnabled: true,
        atCapacity: false,
        presenceStatus: "ON_JOB",
        smartBusyEngaged: true,
      })
    ).toBe(true)
    expect(
      shouldAutoRevertBusy({
        smartBusyEnabled: true,
        atCapacity: false,
        presenceStatus: "ON_JOB",
        smartBusyEngaged: false,
      })
    ).toBe(false)
    expect(
      shouldAutoRevertBusy({
        smartBusyEnabled: true,
        atCapacity: true,
        presenceStatus: "ON_JOB",
        smartBusyEngaged: true,
      })
    ).toBe(false)
  })

  it("formats a capacity summary for banners", () => {
    expect(
      formatSmartBusyCapacitySummary({
        confirmedJobsToday: 4,
        poolCount: 2,
        capacityThreshold: 5,
      })
    ).toContain("6 jobs")
  })
})
