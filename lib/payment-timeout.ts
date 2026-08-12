/**
 * Payment UI helpers — keep Charge buttons from spinning forever when Stripe
 * or Terminal promises never settle (hanging fetch / reader / confirmPayment).
 */

/** Default ceiling for create-intent / confirm API calls. */
export const PAYMENT_API_TIMEOUT_MS = 25_000

/**
 * Ceiling for Stripe.js confirmPayment / elements.submit.
 * Keep aggressive (≤30s): a 90s race still feels like an infinite spinner on-site.
 * 3DS bank prompts usually finish well under this; after timeout, Cancel / pay link.
 */
export const PAYMENT_CONFIRM_TIMEOUT_MS = 25_000

/**
 * Ceiling for Stripe Payment Element to finish mounting (onReady).
 * If Stripe.js / the iframe never loads (Safari blockers, Connect mismatch),
 * fail visibly instead of endless “Loading card form…”.
 */
export const ELEMENTS_LOAD_TIMEOUT_MS = 18_000

/** Ceiling for Terminal discover / connect on web (no infinite spinner). */
export const TERMINAL_DISCOVER_TIMEOUT_MS = 20_000

/** Ceiling for waiting on a customer tap once the reader is ready. */
export const TERMINAL_COLLECT_TIMEOUT_MS = 120_000

/** User-facing copy when card confirm hangs past the ceiling. */
export const CARD_CHARGE_TIMEOUT_MESSAGE =
  "Card charge timed out — try again or send a pay link."

/** User-facing copy when the card form iframe never becomes ready. */
export const CARD_FORM_LOAD_TIMEOUT_MESSAGE =
  "Card form did not load. Tap Try again, or go Back and send a pay link instead."
/**
 * Race a promise against a timeout. Rejects with a clear Error so UI can toast
 * and reset loading in `finally`. Does not cancel the underlying work (Stripe.js
 * has no AbortSignal for confirmPayment) — callers must still clear busy via
 * finally + a generation counter / Cancel button.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message))
    }, ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

/**
 * fetch() with AbortSignal — fails instead of hanging when the network
 * or serverless function stalls.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (e) {
    // AbortError / TimeoutError → plain message for toasts.
    if (
      e instanceof DOMException &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    ) {
      throw new Error(timeoutMessage)
    }
    if (e instanceof Error && /aborted|timeout/i.test(e.message)) {
      throw new Error(timeoutMessage)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}
