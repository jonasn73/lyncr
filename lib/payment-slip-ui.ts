/**
 * Post-charge Tip / signature sheet helpers.
 *
 * Card networks (Visa, Mastercard, Amex, Discover) made cardholder signatures
 * optional for card-present EMV/contactless. Card-not-present (keyed) payments
 * authenticate with AVS/ZIP + CVC — signature was never a network requirement.
 *
 * Lyncr charges the main PaymentIntent first, then offers an optional tip (and
 * sometimes an optional signature). A tip ≥ $0.50 is a SEPARATE second
 * PaymentIntent (new card tap/entry) — not an update of the first charge.
 * Stripe’s Terminal on-receipt tip uses overcapture on one PI; Lyncr’s Collect
 * flow uses an explicit second charge so any business MCC can tip after pay.
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

/**
 * Sheet header subtitle after the job/service amount is already charged.
 * Always warn that a tip means a second card charge (not a silent re-bill of the job).
 */
export function tipSignSheetSubtitle(
  offerSignature: boolean,
  paidAmountLabel?: string
): string {
  // Prefer “Payment of $X received…” when we know the paid amount.
  const paidBit = paidAmountLabel?.trim()
    ? `Payment of ${paidAmountLabel.trim()} received.`
    : "Payment received."
  if (offerSignature) {
    return `${paidBit} Tip and signature are optional — a tip charges the card again for the tip only.`
  }
  return `${paidBit} Tip is optional — a tip charges the card again for the tip only.`
}

/**
 * Inline note under the tip % buttons when a tip amount is selected.
 * Makes clear: job is already paid; tip is a separate charge.
 */
export function tipSignSecondChargeNote(opts: {
  tipAmountLabel: string
  paidAmountLabel: string
}): string {
  return `Payment of ${opts.paidAmountLabel} received. Adding a tip will charge the card again for ${opts.tipAmountLabel} (tip only — not the job again).`
}

/** Primary CTA on the tip sheet (signature is never required). */
export function tipSignPrimaryCta(opts: {
  offerSignature: boolean
  hasSignature: boolean
  tipCents: number
  tipAmountLabel: string
}): string {
  // Tip ≥ $0.50 → next screen asks for Tap/card again (second PaymentIntent).
  if (opts.tipCents >= 50) {
    return `Done · next: charge tip ${opts.tipAmountLabel} on card`
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
