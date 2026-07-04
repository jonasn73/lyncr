import { describe, expect, it } from "vitest"
import {
  DEFAULT_SERVICE_RATE_CARD,
  parseServiceRateCardFromRules,
  resolveServiceRateCard,
} from "@/lib/service-rate-card"
import { calculateServiceQuote } from "@/lib/service-quote-calculator"

describe("parseServiceRateCardFromRules", () => {
  it("returns defaults for plain-text service rules", () => {
    const { rateCard, source } = parseServiceRateCardFromRules("Lockouts start at $95 after hours.")
    expect(source).toBe("default")
    expect(rateCard.services.lockout).toBe(DEFAULT_SERVICE_RATE_CARD.services.lockout)
  })

  it("parses JSON rate_card block from service_rules", () => {
    const raw = JSON.stringify({
      rate_card: {
        services: { lockout: 9900, ignition: 25000 },
        premium_make_cents: 3000,
      },
    })
    const { rateCard, source } = parseServiceRateCardFromRules(raw)
    expect(source).toBe("onboarding_profiles.service_rules")
    expect(rateCard.services.lockout).toBe(9900)
    expect(rateCard.services.ignition).toBe(25000)
    expect(rateCard.premium_make_cents).toBe(3000)
    expect(rateCard.services.key_gen).toBe(DEFAULT_SERVICE_RATE_CARD.services.key_gen)
  })
})

describe("calculateServiceQuote with rateCard", () => {
  it("uses owner lockout base from rate profile", () => {
    const quote = calculateServiceQuote({
      serviceTypeId: "lockout",
      vehicleYear: "2024",
      vehicleMake: "Ford",
      rateCard: resolveServiceRateCard({ services: { lockout: 12000 } }),
      rateCardSource: "onboarding_profiles.service_rules",
    })
    expect(quote.totalCents).toBe(12000)
    expect(quote.lines[0].kind).toBe("base_rate")
    expect(quote.rateCardSource).toBe("onboarding_profiles.service_rules")
  })
})
