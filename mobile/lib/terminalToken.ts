/**
 * Fetches a Stripe Terminal connection token from lyncr.app for the RN SDK.
 * StripeTerminalProvider calls this whenever the SDK needs a fresh secret.
 */

import { API_URL } from "./api"

/** Returns the connection-token secret string expected by StripeTerminalProvider. */
export async function fetchTerminalConnectionToken(): Promise<string> {
  // Call the same API the web Collect Payment sheet uses.
  const res = await fetch(`${API_URL}/api/payments/terminal/connection-token`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  })
  // Parse JSON even on errors so we can surface a useful message.
  const json = (await res.json().catch(() => ({}))) as {
    data?: { secret?: string }
    error?: string
  }
  // Fail loudly if the session expired or Stripe is misconfigured.
  if (!res.ok || !json.data?.secret) {
    throw new Error(json.error || "Could not fetch Terminal connection token")
  }
  // The SDK only needs the secret string.
  return json.data.secret
}
