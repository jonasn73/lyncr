import { describe, expect, it } from "vitest"
import { tipCentsFromChoice } from "@/lib/payment-slip-ui"

describe("pay-link customer tip (before Checkout)", () => {
  it("computes percent tips from the service+tax base", () => {
    // $100.00 base → 15% = $15.00
    expect(tipCentsFromChoice("15", 10000, "")).toBe(1500)
    expect(tipCentsFromChoice("18", 10000, "")).toBe(1800)
    expect(tipCentsFromChoice("20", 10000, "")).toBe(2000)
  })

  it("allows no tip and custom dollars", () => {
    expect(tipCentsFromChoice("none", 10000, "")).toBe(0)
    expect(tipCentsFromChoice("custom", 10000, "7.50")).toBe(750)
    expect(tipCentsFromChoice("custom", 10000, "")).toBe(0)
  })

  it("builds one charge amount as base + tip", () => {
    const baseCents = 8500
    const tipCents = tipCentsFromChoice("20", baseCents, "")
    expect(baseCents + tipCents).toBe(10200)
  })
})
