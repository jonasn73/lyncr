import { describe, expect, it } from "vitest"
import {
  shouldOfferOptionalSignature,
  tipSignPrimaryCta,
  tipSignSecondChargeNote,
  tipSignSheetSubtitle,
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

  it("warns that tip is a second card charge", () => {
    expect(tipSignSheetSubtitle(false, "$1.00")).toBe(
      "Payment of $1.00 received. Tip is optional — a tip charges the card again for the tip only."
    )
    expect(tipSignSheetSubtitle(true, "$25.00")).toBe(
      "Payment of $25.00 received. Tip and signature are optional — a tip charges the card again for the tip only."
    )
  })

  it("explains separate tip charge under tip buttons", () => {
    expect(
      tipSignSecondChargeNote({ tipAmountLabel: "$0.15", paidAmountLabel: "$1.00" })
    ).toBe(
      "Payment of $1.00 received. Adding a tip will charge the card again for $0.15 (tip only — not the job again)."
    )
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

  it("labels Done with next tip card charge when tip is set", () => {
    expect(
      tipSignPrimaryCta({
        offerSignature: false,
        hasSignature: false,
        tipCents: 150,
        tipAmountLabel: "$1.50",
      })
    ).toBe("Done · next: charge tip $1.50 on card")
  })
})
