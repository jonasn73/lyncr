/**
 * Tip + optional signature helpers for Collect / tech Charge.
 *
 * Shop workflow:
 * 1) Amount
 * 2) How to pay (Tap / Card / Pay link / Cash)
 * 3) Card only: key card + ZIP (createPaymentMethod — no charge yet)
 * 4) Hand phone to customer → tip LAST (+ optional signature when applicable)
 * 5) Confirm → one PaymentIntent for job + tip
 *
 * Tip is never a second card charge. Keyed ZIP cards do not require a signature.
 */

/** How the charge was taken — drives whether we show a signature pad. */
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

/** Tip % of a pre-tax+tax base (job / walk-up total before tip). */
export function tipCentsFromChoice(
  tipChoice: "none" | "15" | "18" | "20" | "custom",
  baseCents: number,
  customTipDollars: string
): number {
  if (tipChoice === "none") return 0
  if (tipChoice === "custom") {
    const dollars = parseFloat(customTipDollars)
    if (!Number.isFinite(dollars) || dollars <= 0) return 0
    return Math.round(dollars * 100)
  }
  const pct = Number(tipChoice)
  if (!Number.isFinite(pct) || baseCents <= 0) return 0
  return Math.round(baseCents * (pct / 100))
}

export function tipSignSheetTitle(offerSignature: boolean): string {
  return offerSignature ? "Tip & signature" : "Add a tip"
}

/** Tip screen (last before money moves) — header subtitle. */
export function tipLastSheetSubtitle(baseAmountLabel?: string): string {
  const base = baseAmountLabel?.trim()
  if (base) {
    return `Service ${base}. Add a tip if you like — then we charge once.`
  }
  return "Add a tip if you like — then we charge once for job + tip."
}

/** Shown after card key-in, before tip (owner hands phone over). */
export function cardKeyedHandOffCopy(): string {
  return "Card saved — next the customer adds a tip. Nothing charged yet."
}

/** Tip screen primary for customer-facing handoff. */
export function tipCustomerConfirmCta(totalAmountLabel: string): string {
  return `Confirm · charge ${totalAmountLabel}`
}

/** Total line on tip screen before Tap / Card. */
export function tipLastTotalNote(opts: {
  totalAmountLabel: string
  tipCents: number
  tipAmountLabel: string
  baseAmountLabel: string
}): string {
  if (opts.tipCents > 0) {
    return `Total to charge: ${opts.totalAmountLabel} (job ${opts.baseAmountLabel} + tip ${opts.tipAmountLabel})`
  }
  return `Total to charge: ${opts.totalAmountLabel} (no tip)`
}

/** Primary CTA on tip screen — starts the single charge. */
export function tipLastPrimaryCta(opts: {
  totalAmountLabel: string
  tipCents: number
}): string {
  return `Charge ${opts.totalAmountLabel}`
}

/** Post-pay optional signature (after the single charge). */
export function postPaySignSheetTitle(): string {
  return "Optional signature"
}

export function postPaySignSheetSubtitle(): string {
  return "Payment received — signature is optional (not required)."
}

export function postPaySignPrimaryCta(hasSignature: boolean): string {
  return hasSignature ? "Done — continue" : "Continue without signature"
}

/** @deprecated Prefer tipLastSheetSubtitle */
export function tipSignSheetSubtitle(
  _offerSignature: boolean,
  paidAmountLabel?: string
): string {
  return tipLastSheetSubtitle(paidAmountLabel)
}

/** @deprecated Prefer tipLastTotalNote */
export function tipSignSecondChargeNote(opts: {
  tipAmountLabel: string
  paidAmountLabel: string
}): string {
  return tipLastTotalNote({
    totalAmountLabel: opts.paidAmountLabel,
    tipCents: 1,
    tipAmountLabel: opts.tipAmountLabel,
    baseAmountLabel: opts.paidAmountLabel,
  })
}

/** @deprecated Prefer tipLastPrimaryCta / postPaySignPrimaryCta */
export function tipSignPrimaryCta(opts: {
  offerSignature: boolean
  hasSignature: boolean
  tipCents: number
  tipAmountLabel: string
}): string {
  if (opts.tipCents > 0) {
    return `Charge · includes tip ${opts.tipAmountLabel}`
  }
  if (opts.offerSignature && !opts.hasSignature) {
    return "Continue without signature"
  }
  if (opts.offerSignature && opts.hasSignature) {
    return "Done — continue"
  }
  return "Charge"
}

export function tipSignHandBackCue(opts: {
  offerSignature: boolean
  hasSignature: boolean
}): string | null {
  if (!opts.offerSignature) return null
  return opts.hasSignature
    ? "Thanks — hand the phone back."
    : "Signature is optional — or hand the phone back."
}

/** Aliases used by older tip-before naming during migrate */
export const tipBeforeChargeSubtitle = tipLastSheetSubtitle
export const tipBeforeChargeTotalNote = (opts: {
  totalAmountLabel: string
  tipCents: number
  tipAmountLabel: string
}) =>
  tipLastTotalNote({
    ...opts,
    baseAmountLabel: opts.totalAmountLabel,
  })
export const tipBeforeChargePrimaryCta = tipLastPrimaryCta
