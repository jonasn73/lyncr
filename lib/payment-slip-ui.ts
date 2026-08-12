/**
 * Post-charge Tip / signature sheet helpers.
 *
 * Card networks (Visa, Mastercard, Amex, Discover) made cardholder signatures
 * optional for card-present EMV/contactless. Card-not-present (keyed) payments
 * authenticate with AVS/ZIP + CVC — signature was never a network requirement.
 *
 * Lyncr charges the PaymentIntent first, then offers an optional tip (and
 * sometimes an optional signature). That matches Stripe’s “pay then tip” pattern
 * for separate tip charges / on-receipt style flows.
 */

/** How the base charge was taken — drives whether we show a signature pad. */
export type PaidChargeChannel = "manual_card" | "tap" | "cash"

/**
 * Below this amount, skip the signature pad even for Tap to Pay.
 * Signatures are optional network-wide; we only offer them for larger in-person tickets.
 */
export const OPTIONAL_SIGNATURE_MIN_CENTS = 2500 // $25.00

/**
 * Show an optional signature pad only for Tap to Pay (card-present) above the threshold.
 * Keyed Payment Element (ZIP/AVS) and cash never need a signature step.
 */
export function shouldOfferOptionalSignature(
  channel: PaidChargeChannel | null | undefined,
  amountCents: number
): boolean {
  if (channel !== "tap") return false
  return amountCents >= OPTIONAL_SIGNATURE_MIN_CENTS
}

export function tipSignSheetTitle(offerSignature: boolean): string {
  return offerSignature ? "Tip & signature" : "Add a tip"
}

export function tipSignSheetSubtitle(offerSignature: boolean): string {
  return offerSignature
    ? "Payment received — tip and signature are optional."
    : "Payment received — tip is optional."
}

/** Primary CTA on the tip sheet (signature is never required). */
export function tipSignPrimaryCta(opts: {
  offerSignature: boolean
  hasSignature: boolean
  tipCents: number
  tipAmountLabel: string
}): string {
  if (opts.tipCents >= 50) {
    return `Done · next charge tip ${opts.tipAmountLabel}`
  }
  if (opts.offerSignature && !opts.hasSignature) {
    return "Continue without signature"
  }
  if (opts.offerSignature && opts.hasSignature) {
    return "Done — continue"
  }
  return "Continue"
}

/** Short customer cue under the pad — omit when there is no signature section. */
export function tipSignHandBackCue(opts: {
  offerSignature: boolean
  hasSignature: boolean
}): string | null {
  if (!opts.offerSignature) return null
  return opts.hasSignature
    ? "Thanks — hand the phone back."
    : "Signature is optional — or hand the phone back."
}
