import { describe, expect, it } from "vitest"
import {
  shouldOfferOptionalSignature,
  tipSignPrimaryCta,
  tipSignSheetTitle,
  OPTIONAL_SIGNATURE_MIN_CENTS,
} from "@/lib/payment-slip-ui"

describe("payment-slip-ui signature rules", () => {
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

  it("labels Continue without signature when pad is shown but empty", () => {
    expect(
      tipSignPrimaryCta({
        offerSignature: true,
        hasSignature: false,
        tipCents: 0,
        tipAmountLabel: "$0.00",
      })
    ).toBe("Continue without signature")
    expect(
      tipSignPrimaryCta({
        offerSignature: false,
        hasSignature: false,
        tipCents: 0,
        tipAmountLabel: "$0.00",
      })
    ).toBe("Continue")
  })
})
