import { describe, expect, it } from "vitest"
import {
  laborCentsFrom,
  partsFromInvoiceLineItems,
  partsFromPricingMetadata,
} from "@/lib/compensation/job-parts"

// A $200 job as calculateServiceQuote breaks it down: $120 base, $25 travel,
// $60 key blank (the part), $35 programming. Only the blank is hardware.
const PRICING_METADATA = {
  pricing_metadata: {
    version: 1,
    quoted_price_cents: 24_000,
    lines: [
      { kind: "base_rate", label: "Base service", cents: 12_000 },
      { kind: "distance_travel", label: "Travel", cents: 2_500 },
      { kind: "key_blank", label: "Key blank", cents: 6_000 },
      { kind: "key_programming", label: "Programming", cents: 3_500 },
    ],
  },
}

describe("parts from a booked quote", () => {
  it("counts the key blank and nothing else", () => {
    // Programming and travel are work, not hardware — the business paid for the blank.
    const split = partsFromPricingMetadata(PRICING_METADATA)
    expect(split.partsCents).toBe(6_000)
    expect(split.unknown).toBe(false)
    expect(split.source).toBe("pricing_metadata")
  })

  it("reports zero parts, not unknown, for a job with no hardware line", () => {
    // A lockout has no blank. That is a real answer and labor should be the full
    // subtotal, not a fallback that gets flagged as approximate.
    const lockout = {
      pricing_metadata: {
        lines: [
          { kind: "base_rate", label: "Lockout", cents: 9_500 },
          { kind: "distance_travel", label: "Travel", cents: 2_000 },
        ],
      },
    }
    const split = partsFromPricingMetadata(lockout)
    expect(split.partsCents).toBe(0)
    expect(split.unknown).toBe(false)
  })

  it("is unknown when no breakdown was stored", () => {
    expect(partsFromPricingMetadata({}).unknown).toBe(true)
    expect(partsFromPricingMetadata(null).unknown).toBe(true)
    expect(partsFromPricingMetadata({ pricing_metadata: { lines: [] } }).unknown).toBe(true)
  })
})

describe("parts from an on-site invoice", () => {
  it("counts only the lines the tech marked as parts", () => {
    const split = partsFromInvoiceLineItems([
      { label: "Labor", amount_cents: 14_000, kind: "labor" },
      { label: "Smart key", amount_cents: 6_000, kind: "part" },
    ])
    expect(split.partsCents).toBe(6_000)
    expect(split.unknown).toBe(false)
  })

  it("treats an unmarked line as labor rather than guessing from its label", () => {
    // "Key blank" reads like a part, but nobody said so. Inferring it would move
    // commission money on a guess.
    const split = partsFromInvoiceLineItems([
      { label: "Key blank", amount_cents: 6_000, kind: "labor" },
      { label: "Labor", amount_cents: 14_000, kind: "labor" },
    ])
    expect(split.partsCents).toBe(0)
    expect(split.unknown).toBe(false)
  })

  it("is unknown when no line was classified at all", () => {
    // Rows written before parts tracking — distinguishable from "no parts".
    const split = partsFromInvoiceLineItems([
      { label: "Service", amount_cents: 20_000 },
      { label: "Key", amount_cents: 6_000 },
    ])
    expect(split.unknown).toBe(true)
  })
})

describe("what a labor commission applies to", () => {
  it("takes parts out of the subtotal", () => {
    const split = partsFromPricingMetadata(PRICING_METADATA)
    // $240 job, $60 of blank → $180 of labor. At 30% that is $54, not $72.
    expect(laborCentsFrom(24_000, split)).toBe(18_000)
  })

  it("deducts parts at full cost even when the job was discounted", () => {
    // The blank cost $60 whatever the customer was eventually charged.
    const split = partsFromPricingMetadata(PRICING_METADATA)
    expect(laborCentsFrom(15_000, split)).toBe(9_000)
  })

  it("never goes negative when a job is discounted below its parts cost", () => {
    const split = partsFromPricingMetadata(PRICING_METADATA)
    expect(laborCentsFrom(4_000, split)).toBe(0)
  })

  it("falls back to the whole subtotal when parts are unknown", () => {
    // Overstates labor rather than understating pay — and the caller flags it as
    // approximate so nobody reads it as a real labor figure.
    expect(laborCentsFrom(24_000, partsFromPricingMetadata({}))).toBe(24_000)
  })
})
