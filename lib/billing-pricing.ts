// ============================================
// Retail pricing hints (UI + future Stripe)
// ============================================
// Wholesale Telnyx/OpenAI costs vary — keep margin in subscription + metered overage.
// Tune numbers before launch; this module is the single place the app reads list prices.

export type BillingPlanKey = "trial" | "starter" | "growth" | "enterprise"

export const BILLING_PLAN_ORDER: BillingPlanKey[] = ["trial", "starter", "growth", "enterprise"]

/** Monthly subscription in USD cents (what we charge). */
export const PLAN_MONTHLY_PRICE_CENTS: Record<BillingPlanKey, number> = {
  trial: 0,
  starter: 4900,
  growth: 12900,
  enterprise: 29900,
}

/** Included pooled minutes per month before metered voice applies (rough guardrail). */
export const PLAN_INCLUDED_MINUTES_PER_MONTH: Record<BillingPlanKey, number> = {
  trial: 30,
  starter: 300,
  growth: 1200,
  enterprise: 5000,
}

/** Metered voice overage after included minutes (USD cents per minute). */
export const METERED_VOICE_CENTS_PER_MINUTE = 9

/** Suggested prepaid top-up packs (USD cents). */
export const CREDIT_PACK_CENTS_USD = [1000, 2500, 5000, 10000] as const

export function formatUsdFromCents(cents: number): string {
  const n = Math.round(cents) / 100
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" })
}
