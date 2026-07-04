import { describe, expect, it } from "vitest"
import { calculateServiceQuote } from "@/lib/service-quote-calculator"

describe("calculateServiceQuote", () => {
  it("adds vehicle age surcharge for older cars", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "lockout",
      vehicleYear: "2000",
      vehicleMake: "Ford",
      vehicleModel: "F-150",
    })
    expect(quote.totalCents).toBeGreaterThan(8500)
    expect(quote.lines.some((l) => l.label.includes("age"))).toBe(true)
  })

  it("includes premium make adjustment", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "ignition",
      vehicleYear: "2022",
      vehicleMake: "BMW",
      vehicleModel: "X5",
    })
    expect(quote.totalCents).toBe(22000 + 2500)
  })
})
