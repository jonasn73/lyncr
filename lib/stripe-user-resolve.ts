import type Stripe from "stripe"
import { getOnboardingProfile } from "@/lib/db"
import { getStripeClient } from "@/lib/stripe-config"
import { setUserBillingPlan } from "@/lib/stripe-billing-sync"

/** Primary key for Lyncr accounts — always prefer metadata / client_reference_id over email. */
export function resolveUserIdFromStripeCheckoutSession(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.user_id?.trim() || session.client_reference_id?.trim() || null
}

export function resolveUserIdFromStripeObject(obj: {
  metadata?: Stripe.Metadata | null
  client_reference_id?: string | null
}): string | null {
  const fromMeta = obj.metadata?.user_id?.trim()
  if (fromMeta) return fromMeta
  const ref = obj.client_reference_id?.trim()
  return ref || null
}

/**
 * Recover subscription when webhooks lag — lookup order:
 * 1. onboarding_profiles.stripe_subscription_id (user id keyed)
 * 2. onboarding_profiles.stripe_customer_id
 * 3. Stripe subscription metadata.user_id
 * 4. Email search (legacy fallback only)
 */
export async function recoverStripeSubscriptionForUser(userId: string): Promise<boolean> {
  const stripe = getStripeClient()
  const profile = await getOnboardingProfile(userId)
  const { syncStripeSubscriptionToNeon } = await import("@/lib/stripe-webhook-sync")

  const subId = profile?.stripe_subscription_id?.trim()
  if (subId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subId)
      if (subscription.status === "active" || subscription.status === "trialing") {
        const owner = resolveUserIdFromStripeObject(subscription)
        if (!owner || owner === userId) {
          const customerId =
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer?.id ?? profile?.stripe_customer_id ?? null
          await syncStripeSubscriptionToNeon(userId, subscription, { customerId })
          await setUserBillingPlan(userId, "starter")
          return true
        }
      }
    } catch {
      // Fall through to customer-id lookup.
    }
  }

  const customerId = profile?.stripe_customer_id?.trim()
  if (customerId) {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 20,
    })
    for (const subscription of subs.data) {
      const metaUserId = subscription.metadata?.user_id?.trim()
      if (metaUserId && metaUserId !== userId) continue
      await syncStripeSubscriptionToNeon(userId, subscription, { customerId })
      await setUserBillingPlan(userId, "starter")
      return true
    }
  }

  const user = await import("@/lib/db").then((m) => m.getUser(userId))
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false

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
      await setUserBillingPlan(userId, "starter")
      return true
    }
  }

  return false
}
