import { getStripeClient } from "@/lib/stripe-config"
import { handleStripeCheckoutSessionCompleted } from "@/lib/stripe-billing-sync"
import { resolveUserIdFromStripeCheckoutSession } from "@/lib/stripe-user-resolve"

/** After subscription Checkout redirect — verify session and sync Neon + Telnyx. */
export async function confirmStripeCheckoutSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  })

  const ownerId = resolveUserIdFromStripeCheckoutSession(session)
  if (ownerId && ownerId !== userId) {
    throw new Error("This checkout session belongs to a different account.")
  }

  if (session.payment_status !== "paid" && session.status !== "complete") {
    throw new Error("Payment is not complete yet. Refresh in a moment.")
  }

  await handleStripeCheckoutSessionCompleted(session)
}

export { recoverStripeSubscriptionForUser } from "@/lib/stripe-user-resolve"
