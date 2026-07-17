import { describe, expect, it } from "vitest"
import {
  calculateServiceQuote,
  getVehiclePricingTier,
} from "@/lib/service-quote-calculator"

describe("getVehiclePricingTier", () => {
  it("returns tier3 for late-model vehicles (2020+)", () => {
    expect(getVehiclePricingTier("2022", "Ford", "F-150", "Remote head key")).toBe("tier3")
  })

  it("returns tier3 for 2018+ Toyota/Honda/etc smart keys", () => {
    expect(getVehiclePricingTier("2019", "Toyota", "Camry", "Push start (smart key)")).toBe(
      "tier3"
    )
    expect(getVehiclePricingTier("2018", "Honda", "Civic", "Smart key / prox")).toBe("tier3")
  })

  it("returns tier2 for smart/prox that is not tier3", () => {
    expect(getVehiclePricingTier("2017", "Ford", "Escape", "Push start (smart key)")).toBe(
      "tier2"
    )
  })

  it("returns tier1 for basic transponder / metal keys", () => {
    expect(getVehiclePricingTier("2015", "Chevy", "Malibu", "Turn key (blade)")).toBe("tier1")
  })
})

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

  it("applies tier3 blank, programming, and key-generation risk premium", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "key_generation",
      vehicleYear: "2022",
      vehicleMake: "Toyota",
      vehicleModel: "Camry",
      keyStyle: "Push start (smart key)",
      keyVariantId: "v-abc123",
    })
    expect(quote.pricingTier).toBe("tier3")
    expect(quote.keyBlankCents).toBe(12000)
    expect(quote.programmingCents).toBe(12500)
    expect(quote.highSecurityRiskCents).toBe(5000)
    expect(quote.autoTotalCents).toBe(17500 + 12000 + 12500 + 5000)
    expect(quote.totalCents).toBe(17500 + 12000 + 12500 + 5000)
    expect(quote.lines.some((l) => l.kind === "high_security_risk")).toBe(true)
  })

  it("applies tier2 blank and programming for older smart keys", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "key_duplication",
      vehicleYear: "2016",
      vehicleMake: "Ford",
      vehicleModel: "Escape",
      keyStyle: "Push start (smart key)",
    })
    expect(quote.pricingTier).toBe("tier2")
    expect(quote.keyBlankCents).toBe(6000)
    expect(quote.programmingCents).toBe(6500)
    expect(quote.highSecurityRiskCents).toBe(0)
    expect(quote.autoTotalCents).toBe(9500 + 6000 + 6500)
  })

  it("applies tier1 blank and programming for basic remote-head keys", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "key_duplication",
      vehicleYear: "2015",
      vehicleMake: "Ford",
      vehicleModel: "Fusion",
      keyStyle: "Remote head key",
    })
    expect(quote.pricingTier).toBe("tier1")
    expect(quote.keyBlankCents).toBe(2500)
    expect(quote.programmingCents).toBe(4500)
    expect(quote.autoTotalCents).toBe(9500 + 2500 + 4500)
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
    expect(quote.pricingTier).toBe("tier3")
  })
})
