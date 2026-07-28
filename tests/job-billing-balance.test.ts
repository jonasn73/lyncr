import { describe, expect, it } from "vitest"
import {
  billingBalanceDollarsFromJob,
  formatJobMoneyCents,
  pickPersistedJobQuoteCents,
  resolveJobBaselineDollars,
  resolveJobBillingBalanceCents,
  suggestedJobDepositCents,
} from "@/lib/job-billing-balance"

describe("resolveJobBillingBalanceCents", () => {
  it("uses the editable dollars field when set", () => {
    expect(
      resolveJobBillingBalanceCents({
        editablePriceDollars: "335",
        savedQuotedPriceCents: 8500,
      })
    ).toBe(33500)
  })

  it("falls back to the saved booked quote, never inventing a live total", () => {
    expect(
      resolveJobBillingBalanceCents({
        editablePriceDollars: "",
        savedQuotedPriceCents: 33500,
      })
    ).toBe(33500)
  })

  it("returns 0 when nothing was persisted (no lockout $85 invent)", () => {
    expect(
      resolveJobBillingBalanceCents({
        editablePriceDollars: "",
        savedQuotedPriceCents: null,
      })
    ).toBe(0)
  })
})

describe("resolveJobBaselineDollars", () => {
  it("returns saved baseline dollars only", () => {
    expect(resolveJobBaselineDollars(33500)).toBe(335)
    expect(resolveJobBaselineDollars(null)).toBeNull()
    expect(resolveJobBaselineDollars(0)).toBeNull()
  })
})

describe("pickPersistedJobQuoteCents", () => {
  it("prefers final booked over last quoted", () => {
    expect(
      pickPersistedJobQuoteCents({
        finalBookedTotalCents: 33500,
        lastQuotedPriceCents: 8500,
        quotedPriceCents: 8500,
      })
    ).toBe(33500)
  })
})

describe("billingBalanceDollarsFromJob", () => {
  it("reads persisted cents only", () => {
    expect(billingBalanceDollarsFromJob({ quoted_price_cents: 18500 })).toBe(185)
    expect(billingBalanceDollarsFromJob({ billing_balance_cents: 33500 })).toBe(335)
    expect(billingBalanceDollarsFromJob({ quoted_price_cents: null })).toBe(0)
  })
})

describe("suggestedJobDepositCents", () => {
  it("uses 20% with a $25 floor, never over the balance", () => {
    expect(suggestedJobDepositCents(20000)).toBe(4000) // $40 on $200
    expect(suggestedJobDepositCents(10000)).toBe(2500) // $25 floor on $100
    expect(suggestedJobDepositCents(2000)).toBe(2000) // full $20 when under floor
    expect(suggestedJobDepositCents(40)).toBe(0) // below Stripe $0.50
  })
})

describe("formatJobMoneyCents", () => {
  it("formats whole dollars without cents noise", () => {
    expect(formatJobMoneyCents(4000)).toBe("$40")
    expect(formatJobMoneyCents(2550)).toBe("$25.50")
  })
})
