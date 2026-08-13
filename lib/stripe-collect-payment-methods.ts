// Preferred wallets for Collect / book-link Embedded Checkout (US Connect).
//
// Stripe’s recommended approach for Checkout is *dynamic payment methods*:
// omit `payment_method_types` so Stripe shows every method enabled for the
// connected account (Dashboard → Connect → Payment methods).
//
// Apple Pay + Google Pay ride on `card` once lyncr.app is registered as a
// payment-method domain on that connected account (direct charges).
//
// Explicit lists below are only used as a safe fallback if dynamic create fails.

/** Fallback list if dynamic Checkout create is rejected. */
export const COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES = [
  "card",
  "cashapp",
  "link",
] as const

/** Fallback list including Venmo — only used when Stripe accepts it. */
export const COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO = [
  ...COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES,
  "venmo",
] as const

export type CollectCheckoutPaymentMethod =
  (typeof COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO)[number]

/**
 * BNPL methods that usually need a shipping address — we don’t collect shipping
 * on service pay links, so exclude them from dynamic Checkout to avoid odd UX.
 */
export const COLLECT_CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES = [
  "affirm",
  "afterpay_clearpay",
  "klarna",
] as const

/** True when Stripe rejected a session because a payment method isn’t enabled. */
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
  /** When true, Checkout used Stripe dynamic payment methods (no hardcoded list). */
  dynamicMethods?: boolean
}): string {
  const parts = ["Cards", "Apple Pay", "Google Pay", "Cash App", "Link", "Venmo"]
  if (opts?.dynamicMethods) {
    return (
      `${parts.join(", ")} (and other wallets enabled for this business) appear when ` +
      `turned on in Stripe. Platform: Dashboard → Settings → Connect → Payment methods → ` +
      `Connected accounts — set Cash App Pay and Venmo to On by default. ` +
      `Connected account (e.g. Key Squad): also confirm Payment methods / capabilities. ` +
      `Apple Pay needs lyncr.app registered (Lyncr does this automatically on each pay link).`
    )
  }
  if (opts?.venmoIncluded) {
    return (
      `${parts.join(", ")}. ` +
      `Turn on Cash App and Venmo in Stripe Dashboard → Settings → Connect → ` +
      `Payment methods for connected accounts.`
    )
  }
  if (opts?.venmoAttempted) {
    const withoutVenmo = ["Cards", "Apple Pay", "Google Pay", "Cash App", "Link"]
    return (
      `${withoutVenmo.join(", ")} work when enabled in Stripe. ` +
      `Venmo was not available for this Connect account — turn it on in ` +
      `Stripe Dashboard → Settings → Connect → Payment methods (connected accounts), ` +
      `or leave it off if Stripe has not enabled Venmo for your account type yet.`
    )
  }
  return (
    `${parts.join(", ")}. ` +
    `Turn on Cash App (and Venmo if listed) in Stripe Dashboard → Settings → Connect → ` +
    `Payment methods for connected accounts. Apple Pay needs lyncr.app registered ` +
    `(Lyncr does this automatically).`
  )
}
