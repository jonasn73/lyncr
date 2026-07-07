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
      serviceTypeId: "ignition_repair",
      vehicleYear: "2022",
      vehicleMake: "BMW",
      vehicleModel: "X5",
    })
    expect(quote.totalCents).toBe(22000 + 2500)
  })

  it("adds travel premium from service base plus distance times per-mile rate", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "lockout",
      vehicleYear: "2024",
      vehicleMake: "Ford",
      vehicleModel: "F-150",
      distanceMiles: 18,
    })
    expect(quote.baseCents).toBe(8500)
    expect(quote.distancePremiumCents).toBe(18 * 350)
    expect(quote.autoTotalCents).toBe(8500 + 18 * 350)
    expect(quote.totalCents).toBe(8500 + 18 * 350)
    expect(quote.lines.some((l) => l.kind === "distance_travel")).toBe(true)
  })

  it("adds smart key blank and programming fees from key selection", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "key_generation",
      vehicleYear: "2022",
      vehicleMake: "Toyota",
      vehicleModel: "Camry",
      keyStyle: "Push start (smart key)",
      keyVariantId: "v-abc123",
    })
    expect(quote.keyBlankCents).toBe(6000)
    expect(quote.programmingCents).toBe(4500)
    expect(quote.autoTotalCents).toBe(17500 + 6000 + 4500)
    expect(quote.totalCents).toBe(17500 + 6000 + 4500)
  })

  it("adds high-security blank and programming for remote head keys", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "key_duplication",
      vehicleYear: "2018",
      vehicleMake: "Ford",
      vehicleModel: "Fusion",
      keyStyle: "Remote head key",
    })
    expect(quote.keyBlankCents).toBe(2000)
    expect(quote.programmingCents).toBe(4500)
    expect(quote.autoTotalCents).toBe(9500 + 2000 + 4500)
  })

  it("supports legacy service ids stored on older leads", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "key_gen",
      vehicleYear: "2020",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
    })
    expect(quote.serviceTypeId).toBe("key_generation")
    expect(quote.baseCents).toBe(17500)
  })
})
