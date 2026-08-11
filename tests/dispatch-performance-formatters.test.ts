import { describe, expect, it } from "vitest"
import {
  formatAvgDispatchSpeedMinutes,
  formatBookingJobsFraction,
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

describe("formatBookingJobsFraction", () => {
  it("renders booked jobs over unique callers", () => {
    expect(formatBookingJobsFraction(1, 18)).toBe("1/18")
    expect(formatBookingJobsFraction(0, 3)).toBe("0/3")
    expect(formatBookingJobsFraction(2, 0)).toBeNull()
    expect(formatBookingJobsFraction(undefined, undefined)).toBeNull()
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
    expect(formatRescueRevenueDollars(null)).toBe("—")
    expect(formatRescueRevenueDollars(undefined)).toBe("—")
  })
})
