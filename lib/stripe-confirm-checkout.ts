import { getUser } from "@/lib/db"
import { getStripeClient } from "@/lib/stripe-config"
import { syncStripeSubscriptionToNeon } from "@/lib/stripe-webhook-sync"
import type Stripe from "stripe"

function sessionUserId(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.user_id?.trim() || session.client_reference_id?.trim() || null
}

/** After Checkout redirect — verify session belongs to user and sync Neon + Telnyx. */
export async function confirmStripeCheckoutSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  })

  const ownerId = sessionUserId(session)
  if (ownerId && ownerId !== userId) {
    throw new Error("This checkout session belongs to a different account.")
  }

  if (session.payment_status !== "paid" && session.status !== "complete") {
    throw new Error("Payment is not complete yet. Refresh in a moment.")
  }

  const subRef = session.subscription
  const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id
  if (!subscriptionId) {
    throw new Error("No subscription found on this checkout session.")
  }

  const subscription =
    typeof subRef === "object" && subRef && "current_period_end" in subRef
      ? (subRef as Stripe.Subscription)
      : await stripe.subscriptions.retrieve(subscriptionId)

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null

  await syncStripeSubscriptionToNeon(userId, subscription, { customerId })
}

/** Fallback when webhook missed — find active Stripe sub for this user's email. */
export async function recoverStripeSubscriptionForUser(userId: string): Promise<boolean> {
  const user = await getUser(userId)
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false

  const stripe = getStripeClient()
  const customers = await stripe.customers.list({ email, limit: 20 })

  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: 20,
    })

    for (const subscription of subs.data) {
      const metaUserId = subscription.metadata?.user_id?.trim()
      if (metaUserId && metaUserId !== userId) continue
      await syncStripeSubscriptionToNeon(userId, subscription, { customerId: customer.id })
      return true
    }
  }

  return false
}
