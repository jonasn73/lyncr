// Shared PaymentIntent ownership checks (avoids circular imports with receipts / slips).

import { retrieveLyncrPaymentIntent } from "@/lib/stripe-payment-intent-retrieve"

/** Load a succeeded PaymentIntent the acting user is allowed to receipt / slip. */
export async function loadOwnedPaymentIntent(
  paymentIntentId: string,
  userId: string,
  opts?: { stripeConnectAccountId?: string | null }
): Promise<{
  intent: Awaited<ReturnType<typeof retrieveLyncrPaymentIntent>>["intent"]
  stripeConnectAccountId: string | null
}> {
  const retrieved = await retrieveLyncrPaymentIntent(paymentIntentId, {
    stripeConnectAccountId: opts?.stripeConnectAccountId,
    ownerUserId: userId,
  })
  const { intent, stripeConnectAccountId } = retrieved
  if (intent.status !== "succeeded") {
    throw new Error("Payment is not complete yet")
  }
  const owner = (intent.metadata?.owner_user_id || intent.metadata?.acting_user_id || "").trim()
  const tech = (intent.metadata?.tech_user_id || "").trim()
  if (owner !== userId && tech !== userId) {
    throw new Error("Not allowed to send a receipt for this payment")
  }
  return { intent, stripeConnectAccountId }
}
