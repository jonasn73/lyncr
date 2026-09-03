// Retail subscription tiers shown at checkout (maps to Stripe Price IDs in env).

import type { SubscriptionTier } from "@/lib/subscription-tier"

/** Paid tiers users can pick at checkout (excludes free_trial). */
export type CheckoutSubscriptionTier = "starter" | "professional" | "business"

export function normalizeCheckoutSubscriptionTier(
  raw: string | null | undefined
): CheckoutSubscriptionTier {
  const key = raw?.trim().toLowerCase()
  if (key === "professional" || key === "pro") return "professional"
  if (key === "business" || key === "enterprise") return "business"
  return "starter"
}

export type CheckoutTierOption = {
  tier: CheckoutSubscriptionTier
  name: string
  priceLabel: string
  monthlyCents: number
  description: string
  lineLimitLabel: string
  highlighted?: boolean
}

/** UI copy aligned with landing-page pricing ($19 / $49 / $99). */
export const CHECKOUT_TIER_OPTIONS: CheckoutTierOption[] = [
  {
    tier: "starter",
    name: "Starter",
    priceLabel: "$19/mo",
    monthlyCents: 1900,
    description: "For solo operators",
    lineLimitLabel: "1 business number",
  },
  {
    tier: "professional",
    name: "Professional",
    priceLabel: "$49/mo",
    monthlyCents: 4900,
    description: "For growing businesses",
    lineLimitLabel: "Up to 3 numbers",
    highlighted: true,
  },
  {
    tier: "business",
    name: "Business",
    priceLabel: "$99/mo",
    monthlyCents: 9900,
    description: "For teams & agencies",
    lineLimitLabel: "Unlimited numbers",
  },
]

export function checkoutTierOption(tier: CheckoutSubscriptionTier): CheckoutTierOption {
  return CHECKOUT_TIER_OPTIONS.find((o) => o.tier === tier) ?? CHECKOUT_TIER_OPTIONS[0]
}

/** Checkout tier is the same string stored as subscription_tier after payment. */
export function checkoutTierToSubscriptionTier(tier: CheckoutSubscriptionTier): SubscriptionTier {
  return tier
}
