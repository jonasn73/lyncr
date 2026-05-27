import { getAppUrl } from "@/lib/telnyx"
import { getOnboardingProfile, getUser } from "@/lib/db"
import { formatUsdFromCents } from "@/lib/billing-pricing"
import {
  checkoutTierOption,
  checkoutTierToSubscriptionTier,
  normalizeCheckoutSubscriptionTier,
  type CheckoutSubscriptionTier,
} from "@/lib/subscription-checkout"
import {
  SUBSCRIPTION_TIER_ORDER,
  TIER_DISPLAY_NAME,
  normalizeSubscriptionTier,
  type SubscriptionTier,
} from "@/lib/subscription-tier"
import { getStripeClient, resolveStripePriceIdForTier } from "@/lib/stripe-config"
import { syncStripeSubscriptionToNeon } from "@/lib/stripe-webhook-sync"

export type StripeCheckoutSessionResult = {
  url: string
  sessionId: string
}

/** Creates Stripe Checkout for Starter ($19), Professional ($49), or Business ($99). */
export async function createLyncrSubscriptionCheckout(
  userId: string,
  tierInput: CheckoutSubscriptionTier | string = "starter"
): Promise<StripeCheckoutSessionResult> {
  const tier = normalizeCheckoutSubscriptionTier(tierInput)
  const profile = await getOnboardingProfile(userId)
  if (!profile?.reserved_number?.trim()) {
    throw new Error("Reserve a business line before activating.")
  }
  if (profile.stripe_subscription_id?.trim()) {
    throw new Error(
      "You already have an active subscription. Use plan upgrade to add more lines, or add carrier credit on the Pay tab if your number is still provisioning."
    )
  }

  const user = await getUser(userId)
  const appUrl = getAppUrl().replace(/\/$/, "")
  const stripe = getStripeClient()
  const priceId = await resolveStripePriceIdForTier(stripe, tier)
  const display =
    profile.reserved_number_display?.trim() || profile.reserved_number?.trim() || "Business line"
  const tierMeta = checkoutTierOption(tier)

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: userId,
    customer_email: user?.email?.trim() || undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: {
        user_id: userId,
        reserved_number: profile.reserved_number,
        subscription_tier: checkoutTierToSubscriptionTier(tier),
        plan: tier,
      },
    },
    metadata: {
      checkout_type: "subscription",
      user_id: userId,
      reserved_number: profile.reserved_number,
      line_display: display,
      subscription_tier: checkoutTierToSubscriptionTier(tier),
      plan: tier,
      plan_label: tierMeta.priceLabel,
    },
    success_url: `${appUrl}/dashboard?stripe_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard?stripe_checkout=cancelled`,
  })

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.")
  }

  return { url: session.url, sessionId: session.id }
}

/** @deprecated Use createLyncrSubscriptionCheckout */
export const createLyncrCoreSubscriptionCheckout = createLyncrSubscriptionCheckout

/** One-time Stripe Checkout for prepaid carrier credit (syncs to Telnyx wallet after payment). */
export async function createLyncrCreditPackCheckout(
  userId: string,
  creditCents: number
): Promise<StripeCheckoutSessionResult> {
  if (!Number.isFinite(creditCents) || creditCents < 500) {
    throw new Error("Minimum carrier credit purchase is $5.00.")
  }

  const user = await getUser(userId)
  const appUrl = getAppUrl().replace(/\/$/, "")
  const stripe = getStripeClient()
  const label = formatUsdFromCents(creditCents)

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: userId,
    customer_email: user?.email?.trim() || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: creditCents,
          product_data: {
            name: `Lyncr carrier credit — ${label}`,
            description: "Prepaid balance for phone numbers and call usage on Telnyx.",
          },
        },
      },
    ],
    metadata: {
      checkout_type: "credit_pack",
      user_id: userId,
      credit_cents: String(Math.trunc(creditCents)),
    },
    success_url: `${appUrl}/dashboard/pay?credit_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard/pay?credit_checkout=cancelled`,
  })

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.")
  }

  return { url: session.url, sessionId: session.id }
}

export type SubscriptionUpgradeResult = {
  tier: SubscriptionTier
  tier_label: string
}

/** Change an existing Stripe subscription to a higher tier (prorated). */
export async function upgradeLyncrSubscription(
  userId: string,
  tierInput: CheckoutSubscriptionTier | string
): Promise<SubscriptionUpgradeResult> {
  const tier = normalizeCheckoutSubscriptionTier(tierInput)
  const profile = await getOnboardingProfile(userId)
  const subId = profile?.stripe_subscription_id?.trim()
  if (!subId) {
    throw new Error("No active subscription yet. Choose a plan to activate first.")
  }

  const currentTier = normalizeSubscriptionTier(profile?.subscription_tier)
  const targetTier = checkoutTierToSubscriptionTier(tier)
  const currentIdx = SUBSCRIPTION_TIER_ORDER.indexOf(currentTier)
  const targetIdx = SUBSCRIPTION_TIER_ORDER.indexOf(targetTier)
  if (targetIdx <= currentIdx) {
    throw new Error(
      `You're already on ${TIER_DISPLAY_NAME[currentTier]}. Pick a higher plan to add more business numbers.`
    )
  }

  const stripe = getStripeClient()
  const newPriceId = await resolveStripePriceIdForTier(stripe, tier)
  const subscription = await stripe.subscriptions.retrieve(subId)
  const itemId = subscription.items.data[0]?.id
  if (!itemId) {
    throw new Error("Could not update your plan in Stripe. Contact support if this keeps happening.")
  }

  const updated = await stripe.subscriptions.update(subId, {
    items: [{ id: itemId, price: newPriceId }],
    proration_behavior: "create_prorations",
    metadata: {
      ...subscription.metadata,
      user_id: userId,
      subscription_tier: targetTier,
      plan: tier,
    },
  })

  await syncStripeSubscriptionToNeon(userId, updated)

  return {
    tier: targetTier,
    tier_label: TIER_DISPLAY_NAME[targetTier],
  }
}

/** New subscription checkout, or in-place upgrade when the user already pays monthly. */
export async function createOrUpgradeLyncrSubscription(
  userId: string,
  tierInput: CheckoutSubscriptionTier | string
): Promise<
  | { mode: "checkout"; url: string; sessionId: string }
  | { mode: "upgraded"; tier: SubscriptionTier; tier_label: string }
> {
  const profile = await getOnboardingProfile(userId)
  if (profile?.stripe_subscription_id?.trim()) {
    const upgraded = await upgradeLyncrSubscription(userId, tierInput)
    return { mode: "upgraded", ...upgraded }
  }
  const { url, sessionId } = await createLyncrSubscriptionCheckout(userId, tierInput)
  return { mode: "checkout", url, sessionId }
}
