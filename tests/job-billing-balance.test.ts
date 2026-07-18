import { describe, expect, it } from "vitest"
import {
  pickPersistedJobQuoteCents,
  resolveJobBaselineDollars,
  resolveJobBillingBalanceCents,
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
