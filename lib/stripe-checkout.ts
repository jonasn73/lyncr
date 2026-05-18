import { getAppUrl } from "@/lib/telnyx"
import { getOnboardingProfile, getUser } from "@/lib/db"
import {
  getStripeClient,
  getStripeCorePriceId,
  LYNCR_CORE_PLAN_MONTHLY_CENTS,
} from "@/lib/stripe-config"

export type StripeCheckoutSessionResult = {
  url: string
  sessionId: string
}

/** Creates a Stripe Checkout subscription session for the Lyncr core plan ($29/mo default). */
export async function createLyncrCoreSubscriptionCheckout(userId: string): Promise<StripeCheckoutSessionResult> {
  const profile = await getOnboardingProfile(userId)
  if (!profile?.reserved_number?.trim()) {
    throw new Error("Reserve a business line before activating.")
  }
  if (profile.has_active_subscription) {
    throw new Error("Your subscription is already active.")
  }

  const user = await getUser(userId)
  const appUrl = getAppUrl().replace(/\/$/, "")
  const stripe = getStripeClient()
  const priceId = getStripeCorePriceId()
  const display =
    profile.reserved_number_display?.trim() || profile.reserved_number?.trim() || "Business line"

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: user?.email?.trim() || undefined,
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "usd",
              unit_amount: LYNCR_CORE_PLAN_MONTHLY_CENTS,
              recurring: { interval: "month" },
              product_data: {
                name: "Lyncr Business Line",
                description: `Live phone routing for ${display}`,
              },
            },
            quantity: 1,
          },
        ],
    subscription_data: {
      metadata: {
        user_id: userId,
        reserved_number: profile.reserved_number,
      },
    },
    metadata: {
      user_id: userId,
      reserved_number: profile.reserved_number,
    },
    success_url: `${appUrl}/dashboard?stripe_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard?stripe_checkout=cancelled`,
  })

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.")
  }

  return { url: session.url, sessionId: session.id }
}
