import { describe, expect, it } from "vitest"
import { applyNegotiationDiscount, parseQuoteDollars } from "@/lib/price-negotiation"

describe("price-negotiation", () => {
  it("subtracts fixed amounts from the current quote", () => {
    expect(
      applyNegotiationDiscount({
        discountId: "aftermarket_key_swap",
        currentPriceDollars: 204,
        baselineCents: 20400,
      })
    ).toBe(164)
    expect(
      applyNegotiationDiscount({
        discountId: "route_optimization",
        currentPriceDollars: 204,
        baselineCents: 20400,
      })
    ).toBe(179)
  })

  it("applies ten percent off the baseline total", () => {
    expect(
      applyNegotiationDiscount({
        discountId: "first_time_callback",
        currentPriceDollars: 204,
        baselineCents: 20400,
      })
    ).toBe(184)
  })

  it("parses editable quote strings", () => {
    expect(parseQuoteDollars("175", 20400)).toBe(175)
    expect(parseQuoteDollars("", 20400)).toBe(204)
  })
})
