import Stripe from "stripe"

/** Core SaaS plan — $29/month unless overridden in env. */
export const LYNCR_CORE_PLAN_MONTHLY_CENTS = Number(process.env.STRIPE_CORE_PLAN_AMOUNT_CENTS || 2900)

export function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
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
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
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

export function getStripeCorePriceId(): string | null {
  const id = process.env.STRIPE_CORE_PRICE_ID?.trim()
  return id || null
}
