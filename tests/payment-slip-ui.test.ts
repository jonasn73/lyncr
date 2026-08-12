import { describe, expect, it } from "vitest"
import {
  shouldOfferOptionalSignature,
  tipCentsFromChoice,
  tipLastPrimaryCta,
  tipLastSheetSubtitle,
  tipLastTotalNote,
  tipSignSheetTitle,
  OPTIONAL_SIGNATURE_MIN_CENTS,
} from "@/lib/payment-slip-ui"

describe("payment-slip-ui tip-last single charge", () => {
  it("never offers signature for keyed card (ZIP/AVS) or cash", () => {
    expect(shouldOfferOptionalSignature("manual_card", 50_00)).toBe(false)
    expect(shouldOfferOptionalSignature("cash", 50_00)).toBe(false)
    expect(shouldOfferOptionalSignature(null, 50_00)).toBe(false)
  })

  it("offers optional signature only for Tap above the threshold", () => {
    expect(shouldOfferOptionalSignature("tap", OPTIONAL_SIGNATURE_MIN_CENTS - 1)).toBe(false)
    expect(shouldOfferOptionalSignature("tap", OPTIONAL_SIGNATURE_MIN_CENTS)).toBe(true)
  })

  it("uses tip-only title when signature is not offered", () => {
    expect(tipSignSheetTitle(false)).toBe("Add a tip")
    expect(tipSignSheetTitle(true)).toBe("Tip & signature")
  })

  it("computes tip cents from percent and custom", () => {
    expect(tipCentsFromChoice("15", 100_00, "")).toBe(15_00)
    expect(tipCentsFromChoice("none", 100_00, "")).toBe(0)
    expect(tipCentsFromChoice("custom", 100_00, "2.50")).toBe(250)
  })

  it("tip sheet copy says one charge after tip", () => {
    expect(tipLastSheetSubtitle("$10.00")).toContain("charge once")
    expect(
      tipLastTotalNote({
        totalAmountLabel: "$11.50",
        tipCents: 150,
        tipAmountLabel: "$1.50",
        baseAmountLabel: "$10.00",
      })
    ).toBe("Total to charge: $11.50 (job $10.00 + tip $1.50)")
    expect(tipLastPrimaryCta({ totalAmountLabel: "$11.50", tipCents: 150 })).toBe(
      "Charge $11.50"
    )
  })
})
