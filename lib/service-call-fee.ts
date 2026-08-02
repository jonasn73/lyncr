// $49 service-call fee — deposit before a tech is dispatched (Key Squad live-call flow).

/** Default service-call fee in USD (operator “Send $49” button). */
export const SERVICE_CALL_FEE_DOLLARS = 49

/** Same fee in cents for Stripe / pay-link APIs. */
export const SERVICE_CALL_FEE_CENTS = SERVICE_CALL_FEE_DOLLARS * 100

/** Short product name on Stripe line items + SMS. */
export const SERVICE_CALL_FEE_LABEL = "Service call fee ($49)"

/**
 * Customer-facing form+pay URL.
 * Form first (name, address, YMM, copy vs AKL), then redirect to /pay/{token}.
 */
export function buildServiceCallFormUrl(appUrl: string, payToken: string): string {
  // Strip trailing slash so we never get //pay/...
  const base = appUrl.replace(/\/$/, "")
  // Opaque pay token authorizes the public form + checkout handoff
  return `${base}/pay/service-call?p=${encodeURIComponent(payToken)}`
}
