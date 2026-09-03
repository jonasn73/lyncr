// Subscription tiers, line limits, and Stripe price → tier mapping.

export type SubscriptionTier = "free_trial" | "starter" | "professional" | "business"

export const SUBSCRIPTION_TIER_ORDER: SubscriptionTier[] = [
  "free_trial",
  "starter",
  "professional",
  "business",
]

/** Max active business numbers per tier. */
const TIER_ACTIVE_NUMBER_LIMIT: Record<SubscriptionTier, number> = {
  free_trial: 1,
  starter: 1,
  professional: 3,
  business: 999,
}

/** USD provisioning fee per new carrier line. */
export const CARRIER_PROVISIONING_FEE_USD = 2.0

export const TIER_DISPLAY_NAME: Record<SubscriptionTier, string> = {
  free_trial: "Free trial",
  starter: "Starter",
  professional: "Professional",
  business: "Business",
}

export function normalizeSubscriptionTier(raw: string | null | undefined): SubscriptionTier {
  const key = raw?.trim().toLowerCase()
  if (key && SUBSCRIPTION_TIER_ORDER.includes(key as SubscriptionTier)) {
    return key as SubscriptionTier
  }
  return "free_trial"
}

export function tierActiveNumberLimit(tier: SubscriptionTier): number {
  return TIER_ACTIVE_NUMBER_LIMIT[tier]
}

export function canAddNumberForTier(tier: SubscriptionTier, activeCount: number): boolean {
  return activeCount < tierActiveNumberLimit(tier)
}

/** User-facing upgrade prompt when at line cap. */
export function tierUpgradeMessage(tier: SubscriptionTier): string | null {
  if (tier === "free_trial") {
    return "Activate a Starter or Professional plan to add business numbers."
  }
  if (tier === "starter") {
    return "Upgrade to Professional to add up to 3 business numbers."
  }
  if (tier === "professional") {
    return "Upgrade to Business for additional business numbers."
  }
  return null
}

export function tierUpgradeTarget(tier: SubscriptionTier): SubscriptionTier | null {
  if (tier === "free_trial") return "starter"
  if (tier === "starter") return "professional"
  if (tier === "professional") return "business"
  return null
}

/** Resolve tier from Stripe Price id env vars. */
export function subscriptionTierFromStripePriceId(priceId: string | null | undefined): SubscriptionTier | null {
  const id = priceId?.trim()
  if (!id) return null

  const starterIds = [
    process.env.STRIPE_PRICE_STARTER?.trim(),
    process.env.STRIPE_STARTER_PRICE_ID?.trim(),
    process.env.STRIPE_CORE_PRICE_ID?.trim(),
  ].filter(Boolean)

  const professionalIds = [
    process.env.STRIPE_PRICE_PROFESSIONAL?.trim(),
    process.env.STRIPE_PROFESSIONAL_PRICE_ID?.trim(),
  ].filter(Boolean)

  const businessIds = [
    process.env.STRIPE_PRICE_BUSINESS?.trim(),
    process.env.STRIPE_BUSINESS_PRICE_ID?.trim(),
  ].filter(Boolean)

  if (starterIds.includes(id)) return "starter"
  if (professionalIds.includes(id)) return "professional"
  if (businessIds.includes(id)) return "business"
  return null
}

export function hasEnoughCarrierCredit(carrierCreditUsd: number): boolean {
  return carrierCreditUsd >= CARRIER_PROVISIONING_FEE_USD
}

/** Map subscription tier to legacy users.billing_plan column. */
export function billingPlanKeyFromSubscriptionTier(tier: SubscriptionTier): string {
  if (tier === "professional") return "growth"
  if (tier === "business") return "enterprise"
  if (tier === "starter") return "starter"
  return "trial"
}
