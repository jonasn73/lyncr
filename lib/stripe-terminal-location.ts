// Resolve a Stripe Terminal Location id for Tap to Pay / reader connect.
// Prefer STRIPE_TERMINAL_LOCATION_ID; otherwise reuse or create a per-user Location.

import { getStripeClient } from "@/lib/stripe-config"

/**
 * Returns a Stripe Terminal location id the mobile SDK can pass to connectReader / easyConnect.
 * Set STRIPE_TERMINAL_LOCATION_ID in Vercel for a shared HQ location, or let this create one per user.
 */
export async function getOrCreateTerminalLocationId(params: {
  userId: string
  displayName: string
}): Promise<string> {
  const fromEnv = process.env.STRIPE_TERMINAL_LOCATION_ID?.trim()
  if (fromEnv) return fromEnv

  const stripe = getStripeClient()
  const existing = await stripe.terminal.locations.list({ limit: 100 })
  const match = existing.data.find((loc) => loc.metadata?.lyncr_user_id === params.userId)
  if (match?.id) return match.id

  const displayName = (params.displayName || "Lyncr").slice(0, 40)
  const created = await stripe.terminal.locations.create({
    display_name: displayName,
    // Placeholder address for field / mobile charging — override with STRIPE_TERMINAL_LOCATION_ID in production if needed.
    address: {
      line1: "1 Business Way",
      city: "Miami",
      state: "FL",
      country: "US",
      postal_code: "33101",
    },
    metadata: { lyncr_user_id: params.userId },
  })
  return created.id
}
