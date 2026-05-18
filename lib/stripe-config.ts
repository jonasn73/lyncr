import Stripe from "stripe"

/** Fallback amount (cents) when creating inline prices — production should use STRIPE_CORE_PRICE_ID. */
export const LYNCR_CORE_PLAN_MONTHLY_CENTS = Number(process.env.STRIPE_CORE_PLAN_AMOUNT_CENTS || 100)

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

export function getStripeSecretKey(): string {
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

let stripeSingleton: Stripe | null = null

export function getStripeClient(): Stripe {
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(getStripeSecretKey(), {
      typescript: true,
    })
  }
  return stripeSingleton
}

/** Live/test subscription price — set STRIPE_CORE_PRICE_ID to your $1.00 test price in Vercel. */
export function getStripeCorePriceId(): string {
  const id =
    process.env.STRIPE_CORE_PRICE_ID?.trim() || process.env.STRIPE_TEST_PRICE_ID?.trim() || ""
  if (!id) {
    throw new Error(
      "Missing STRIPE_CORE_PRICE_ID — add your live $1.00 test price id (price_…) in Vercel env."
    )
  }
  return id
}
