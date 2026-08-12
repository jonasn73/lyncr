/**
 * Payment UI helpers — keep Charge buttons from spinning forever when Stripe
 * or Terminal promises never settle (hanging fetch / reader / confirmPayment).
 */

/** Default ceiling for create-intent / confirm API calls. */
export const PAYMENT_API_TIMEOUT_MS = 25_000

/** Ceiling for Stripe.js confirmPayment (3DS can take a bit; still must end). */
export const PAYMENT_CONFIRM_TIMEOUT_MS = 90_000

/** Ceiling for Terminal discover / connect on web (no infinite spinner). */
export const TERMINAL_DISCOVER_TIMEOUT_MS = 20_000

/** Ceiling for waiting on a customer tap once the reader is ready. */
export const TERMINAL_COLLECT_TIMEOUT_MS = 120_000

/**
 * Race a promise against a timeout. Rejects with a clear Error so UI can toast
 * and reset loading in `finally`.
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
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

/**
 * fetch() with AbortSignal.timeout — fails instead of hanging when the network
 * or serverless function stalls.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  timeoutMessage: string
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(ms),
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
  }
}
