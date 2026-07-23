/**
 * Turn Stripe card / Terminal failures into plain-English reasons for techs.
 * Safe to use in the browser (no secret keys).
 */

/** True when the publishable key is live (pk_live_…), not test. */
export function isStripeLivePublishableKey(publishableKey: string | null | undefined): boolean {
  const key = (publishableKey ?? "").trim()
  return key.startsWith("pk_live_")
}

/** True when the publishable key is test mode (pk_test_…). */
export function isStripeTestPublishableKey(publishableKey: string | null | undefined): boolean {
  const key = (publishableKey ?? "").trim()
  return key.startsWith("pk_test_")
}

/** Message when no real tap reader is available (never use simulator on live keys). */
export function tapToPayNoReaderMessage(isLiveMode: boolean): string {
  if (isLiveMode) {
    return (
      "No tap reader on this device. Live charges need a real reader — open Tap to Pay in the Stripe Dashboard app (iPhone) or pair a Stripe reader. " +
      "Or use Card / Apple Pay / Cash App below."
    )
  }
  return (
    "No tap reader found. In test mode you can use a simulated reader on desktop; on a phone, use Card entry or the Stripe Dashboard app."
  )
}

/** Human label for common Stripe decline_code values. */
const DECLINE_REASONS: Record<string, string> = {
  insufficient_funds: "Card was declined — insufficient funds.",
  lost_card: "Card was declined — reported lost. Ask for another card.",
  stolen_card: "Card was declined — reported stolen. Ask for another card.",
  expired_card: "Card is expired. Ask for another card.",
  incorrect_cvc: "Wrong security code (CVC). Try again.",
  incorrect_number: "Card number looks wrong. Check and try again.",
  invalid_cvc: "Security code (CVC) is invalid. Try again.",
  invalid_expiry_month: "Expiration month is invalid.",
  invalid_expiry_year: "Expiration year is invalid.",
  invalid_number: "Card number is invalid.",
  card_not_supported: "This card type isn’t supported. Try another card.",
  currency_not_supported: "This card doesn’t support this currency.",
  do_not_honor: "Bank declined the charge (do not honor). Try another card.",
  generic_decline: "Bank declined the charge. Try another card.",
  call_issuer: "Bank asks the customer to call their card issuer, then try again.",
  pickup_card: "Bank declined — ask for another card.",
  restricted_card: "Card is restricted. Try another card.",
  processing_error: "Card network error. Wait a moment and try again.",
  try_again_later: "Temporary bank issue. Try again in a minute.",
  authentication_required: "Customer must approve the charge (3D Secure). Try again and complete the prompt.",
  transaction_not_allowed: "Bank blocked this type of charge. Try another card.",
}

/** Friendly text for Stripe error.code values. */
const ERROR_CODE_REASONS: Record<string, string> = {
  card_declined: "Card was declined by the bank.",
  expired_card: "Card is expired.",
  incorrect_cvc: "Wrong security code (CVC).",
  incorrect_number: "Card number looks wrong.",
  incorrect_zip: "ZIP / postal code doesn’t match the card.",
  processing_error: "Card network error — try again.",
  payment_intent_authentication_failure: "Customer didn’t finish bank verification (3D Secure).",
  payment_intent_payment_attempt_failed: "Payment attempt failed.",
  amount_too_small: "Amount is too small to charge.",
  amount_too_large: "Amount is too large for this card.",
  balance_insufficient: "Insufficient balance (wallet / bank).",
}

export type StripeLikeError = {
  message?: string | null
  code?: string | null
  decline_code?: string | null
  type?: string | null
}

/**
 * Build a clear reason for a failed card / wallet charge.
 * Prefers decline_code → code → Stripe’s message → fallback.
 */
export function formatStripeCardFailure(
  error: StripeLikeError | null | undefined,
  fallback = "Payment failed — try another card or payment method."
): string {
  if (!error) return fallback

  const decline = (error.decline_code ?? "").trim().toLowerCase()
  if (decline && DECLINE_REASONS[decline]) return DECLINE_REASONS[decline]

  const code = (error.code ?? "").trim().toLowerCase()
  if (code && ERROR_CODE_REASONS[code]) {
    const stripeMsg = (error.message ?? "").trim()
    // Keep Stripe’s message when it already names the bank reason.
    if (stripeMsg && stripeMsg.length > 12 && !/payment failed/i.test(stripeMsg)) {
      return `${ERROR_CODE_REASONS[code]} ${stripeMsg}`
    }
    return ERROR_CODE_REASONS[code]
  }

  const message = (error.message ?? "").trim()
  if (message) {
    // Rewrite the exact simulator / live-key mismatch into plain English.
    if (/only test mode keys are allowed with the simulator/i.test(message)) {
      return (
        "Tap simulator only works with Stripe test keys. You’re on live keys — use a real Tap to Pay reader, or charge with Card / Apple Pay / Cash App."
      )
    }
    return message
  }

  return fallback
}

/** Format unknown catch values (Error, StripeError, string). */
export function formatPaymentCatchError(
  err: unknown,
  fallback = "Payment failed — try again."
): string {
  if (!err) return fallback
  if (typeof err === "string" && err.trim()) {
    return formatStripeCardFailure({ message: err }, fallback)
  }
  if (typeof err === "object") {
    const o = err as StripeLikeError & { error?: StripeLikeError }
    // Terminal SDK sometimes nests { error: { message } }
    if (o.error && (o.error.message || o.error.code)) {
      return formatStripeCardFailure(o.error, fallback)
    }
    if (o.message || o.code || o.decline_code) {
      return formatStripeCardFailure(o, fallback)
    }
  }
  if (err instanceof Error && err.message) {
    return formatStripeCardFailure({ message: err.message }, fallback)
  }
  return fallback
}
