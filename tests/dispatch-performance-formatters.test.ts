import { describe, expect, it } from "vitest"
import {
  formatAvgDispatchSpeedMinutes,
  formatBookingRatePercent,
  formatRescueRevenueDollars,
} from "@/lib/dispatch-performance-formatters"

describe("formatBookingRatePercent", () => {
  it("renders whole-number percents", () => {
    expect(formatBookingRatePercent(78.4)).toBe("78%")
    expect(formatBookingRatePercent(0)).toBe("0%")
    expect(formatBookingRatePercent(undefined)).toBe("0%")
  })
})

describe("formatAvgDispatchSpeedMinutes", () => {
  it("renders one decimal under 10 minutes", () => {
    expect(formatAvgDispatchSpeedMinutes(2.44)).toBe("2.4 min")
    expect(formatAvgDispatchSpeedMinutes(null)).toBe("—")
  })
})

describe("formatRescueRevenueDollars", () => {
  it("converts cents to dollar labels", () => {
    expect(formatRescueRevenueDollars(85000)).toBe("$850")
    expect(formatRescueRevenueDollars(0)).toBe("$0")
  })
})
