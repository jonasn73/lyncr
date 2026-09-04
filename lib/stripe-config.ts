import Stripe from "stripe"
import { PLAN_MONTHLY_PRICE_CENTS, type BillingPlanKey } from "@/lib/billing-pricing"
import type { CheckoutSubscriptionTier } from "@/lib/subscription-checkout"

/** Fallback amount (cents) when creating inline prices — production uses Stripe Price IDs. */
const LYNCR_STARTER_PLAN_MONTHLY_CENTS = PLAN_MONTHLY_PRICE_CENTS.starter


/** Reads Stripe secret — supports common Vercel typo `KeyValueSTRIPE_SECRET_KEY`. */
function readStripeSecretKeyFromEnv(): string | undefined {
  const candidates = [
    process.env.STRIPE_SECRET_KEY,
    process.env.KeyValueSTRIPE_SECRET_KEY,
  ]
  for (const raw of candidates) {
    const trimmed = raw?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function getStripeSecretKey(): string {
  const key = readStripeSecretKeyFromEnv()
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY")
  }
  return key
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET")
  }
  return secret
}

export function isStripeConfigured(): boolean {
  return Boolean(readStripeSecretKeyFromEnv())
}

/** Publishable key for Stripe.js / Payment Element (safe in the browser). */
export function getStripePublishableKey(): string | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
  return key || null
}

let stripeSingleton: Stripe | null = null

export function getStripeClient(): Stripe {
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(getStripeSecretKey(), {
      typescript: true,
    })
  }
  return stripeSingleton
}

/** Production Starter plan price id — STRIPE_PRICE_STARTER or legacy STRIPE_STARTER_PRICE_ID. */
function getStripeStarterPriceId(): string {
  const id =
    process.env.STRIPE_PRICE_STARTER?.trim() ||
    process.env.STRIPE_STARTER_PRICE_ID?.trim() ||
    process.env.STRIPE_CORE_PRICE_ID?.trim() ||
    process.env.STRIPE_TEST_PRICE_ID?.trim() ||
    ""
  if (!id) {
    throw new Error(
      "Missing STRIPE_STARTER_PRICE_ID — add your live Starter plan price id (price_…) in Vercel env."
    )
  }
  return id
}

/** @deprecated Use getStripeStarterPriceId */
export function getStripeCorePriceId(): string {
  return getStripeStarterPriceId()
}

/** Professional tier price id — set STRIPE_PRICE_PROFESSIONAL in Vercel. */
function getStripeProfessionalPriceId(): string | null {
  return (
    process.env.STRIPE_PRICE_PROFESSIONAL?.trim() ||
    process.env.STRIPE_PROFESSIONAL_PRICE_ID?.trim() ||
    null
  )
}

/** Business tier price id — set STRIPE_PRICE_BUSINESS in Vercel. */
function getStripeBusinessPriceId(): string | null {
  return (
    process.env.STRIPE_PRICE_BUSINESS?.trim() ||
    process.env.STRIPE_BUSINESS_PRICE_ID?.trim() ||
    null
  )
}

/** Raw price id from env for a checkout tier (throws if missing). */
function getStripePriceIdForTier(tier: CheckoutSubscriptionTier): string {
  if (tier === "starter") return getStripeStarterPriceId()
  if (tier === "professional") {
    const id = getStripeProfessionalPriceId()
    if (!id) {
      throw new Error(
        "Missing STRIPE_PRICE_PROFESSIONAL — add your Professional plan price id (price_…) in Vercel env."
      )
    }
    return id
  }
  const id = getStripeBusinessPriceId()
  if (!id) {
    throw new Error(
      "Missing STRIPE_PRICE_BUSINESS — add your Business plan price id (price_…) in Vercel env."
    )
  }
  return id
}

/** Resolve price_ id from env (handles prod_… misconfiguration). */
async function resolveStripePriceId(stripe: Stripe, rawPriceId: string): Promise<string> {
  const id = rawPriceId.trim()
  if (id.startsWith("price_")) return id
  if (id.startsWith("prod_")) {
    const product = await stripe.products.retrieve(id, { expand: ["default_price"] })
    const defaultPrice = product.default_price
    if (typeof defaultPrice === "string") return defaultPrice
    if (defaultPrice && typeof defaultPrice === "object" && "id" in defaultPrice) {
      return defaultPrice.id
    }
    const prices = await stripe.prices.list({
      product: id,
      active: true,
      type: "recurring",
      limit: 1,
    })
    const fallback = prices.data[0]?.id
    if (fallback) return fallback
    throw new Error(
      `Stripe product (${id}) has no recurring price. Copy the price id (price_…) into Vercel env.`
    )
  }
  throw new Error(
    `Stripe price id must start with price_ (not "${id.slice(0, 8)}…"). Copy the Price id from Stripe Dashboard.`
  )
}

/** Resolve checkout-ready price id for Starter / Professional / Business. */
export async function resolveStripePriceIdForTier(
  stripe: Stripe,
  tier: CheckoutSubscriptionTier
): Promise<string> {
  return resolveStripePriceId(stripe, getStripePriceIdForTier(tier))
}

/**
 * AI Assistant minutes metered price (`087`) — a graduated Stripe Price (N minutes included,
 * then $/min) backing a Billing Meter, one per tier since included minutes differ. Optional
 * and unset until manually created in the Stripe Dashboard, so this returns null instead of
 * throwing — callers should skip the line item / usage report rather than fail checkout.
 */
function getStripeAiMinutesPriceIdRaw(tier: CheckoutSubscriptionTier): string | null {
  if (tier === "professional") {
    return process.env.STRIPE_PRICE_AI_MINUTES_PROFESSIONAL?.trim() || null
  }
  if (tier === "business") {
    return process.env.STRIPE_PRICE_AI_MINUTES_BUSINESS?.trim() || null
  }
  return null
}

/** Checkout-ready AI-minutes metered price id for a tier, or null if not configured yet. */
export async function resolveStripeAiMinutesPriceId(
  stripe: Stripe,
  tier: CheckoutSubscriptionTier
): Promise<string | null> {
  const raw = getStripeAiMinutesPriceIdRaw(tier)
  if (!raw) return null
  try {
    return await resolveStripePriceId(stripe, raw)
  } catch (e) {
    console.warn("[stripe-config] AI-minutes price id misconfigured, skipping line item:", e)
    return null
  }
}

/** Turns Starter price env into a Checkout-ready price id (handles prod_… misconfiguration). */
export async function resolveStripeStarterPriceId(stripe: Stripe): Promise<string> {
  return resolveStripePriceId(stripe, getStripeStarterPriceId())
}


export function planMonthlyPriceCents(plan: BillingPlanKey): number {
  return PLAN_MONTHLY_PRICE_CENTS[plan] ?? PLAN_MONTHLY_PRICE_CENTS.starter
}
