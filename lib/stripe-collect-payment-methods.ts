// Preferred wallets for Collect / book-link Embedded Checkout (US Connect).
// Apple Pay + Google Pay appear automatically when `card` is on and the pay domain is registered.
// Venmo is attempted; if the Connect account rejects it, we fall back without Venmo.

export const COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES = [
  "card",
  "cashapp",
  "link",
] as const

/** Same list plus Venmo — only used when Stripe accepts it for this Connect account. */
export const COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO = [
  ...COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES,
  "venmo",
] as const

export type CollectCheckoutPaymentMethod =
  (typeof COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO)[number]

/** True when Stripe rejected a session because Venmo (or similar) isn’t enabled. */
export function isUnsupportedPaymentMethodError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "")
  const lower = msg.toLowerCase()
  return (
    lower.includes("payment_method") ||
    lower.includes("venmo") ||
    lower.includes("cashapp") ||
    lower.includes("invalid") ||
    lower.includes("not activated") ||
    lower.includes("not enabled")
  )
}

/**
 * Human summary for owners — what customers can pay with after Dashboard toggles.
 * Used in Activity send success toasts / return payloads.
 */
export function collectCheckoutWalletSummary(opts?: {
  venmoAttempted?: boolean
  venmoIncluded?: boolean
}): string {
  const parts = ["Cards", "Apple Pay", "Google Pay", "Cash App", "Link"]
  if (opts?.venmoIncluded) {
    parts.push("Venmo")
  } else if (opts?.venmoAttempted) {
    // Venmo was requested but Stripe/Connect rejected it for this account
    return (
      `${parts.join(", ")} work when enabled in Stripe. ` +
      `Venmo was not available for this Connect account — turn it on in ` +
      `Stripe Dashboard → Settings → Payment methods (connected accounts), ` +
      `or leave it off if Stripe has not enabled Venmo for your account type yet.`
    )
  }
  return (
    `${parts.join(", ")}. ` +
    `Turn on Cash App (and Venmo if listed) in Stripe Dashboard → Settings → ` +
    `Payment methods for connected accounts. Apple Pay needs lyncr.app registered ` +
    `(Lyncr does this automatically).`
  )
}
