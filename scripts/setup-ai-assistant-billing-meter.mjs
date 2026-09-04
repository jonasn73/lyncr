#!/usr/bin/env node
// One-time Stripe setup for AI Assistant minute overage billing (087).
//
// Creates:
//   - a Billing Meter named "ai_assistant_minutes"
//   - a metered Price for Professional (100 min included, then $0.10/min)
//   - a metered Price for Business (300 min included, then $0.08/min)
//
// Idempotent: safe to re-run — it looks up existing objects by lookup_key /
// event_name before creating anything, and never deletes or modifies what's
// already there (Stripe doesn't allow deleting Meters or Prices anyway, only
// archiving, so getting this wrong is not cheaply reversible — review the
// numbers below before running).
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-ai-assistant-billing-meter.mjs
//
// After it finishes, copy the two printed price IDs into Vercel env as
// STRIPE_PRICE_AI_MINUTES_PROFESSIONAL and STRIPE_PRICE_AI_MINUTES_BUSINESS.
// No redeploy needed — lib/stripe-config.ts reads them live.

import Stripe from "stripe"

const EVENT_NAME = "ai_assistant_minutes"
const CURRENCY = "usd"

const TIERS = [
  {
    key: "professional",
    lookupKey: "ai_assistant_minutes_professional",
    productName: "AI Assistant Minutes — Professional",
    includedMinutes: 100,
    overageCentsPerMinute: 10, // $0.10/min
  },
  {
    key: "business",
    lookupKey: "ai_assistant_minutes_business",
    productName: "AI Assistant Minutes — Business",
    includedMinutes: 300,
    overageCentsPerMinute: 8, // $0.08/min
  },
]

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) {
    console.error("Missing STRIPE_SECRET_KEY. Run: STRIPE_SECRET_KEY=sk_live_... node scripts/setup-ai-assistant-billing-meter.mjs")
    process.exit(1)
  }
  if (!secretKey.startsWith("sk_live_") && !secretKey.startsWith("sk_test_")) {
    console.error("STRIPE_SECRET_KEY doesn't look like a real Stripe secret key (expected sk_live_... or sk_test_...).")
    process.exit(1)
  }
  const mode = secretKey.startsWith("sk_live_") ? "LIVE" : "TEST"
  console.log(`Running against Stripe ${mode} mode.\n`)

  const stripe = new Stripe(secretKey, { typescript: false })

  // 1. Meter — find existing by event_name, or create.
  let meter = null
  const meters = await stripe.billing.meters.list({ limit: 100 })
  meter = meters.data.find((m) => m.event_name === EVENT_NAME) ?? null
  if (meter) {
    console.log(`✓ Meter already exists: ${meter.id} (${meter.display_name})`)
  } else {
    meter = await stripe.billing.meters.create({
      display_name: "AI Assistant Minutes",
      event_name: EVENT_NAME,
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    })
    console.log(`+ Created meter: ${meter.id}`)
  }

  const results = {}

  for (const tier of TIERS) {
    const existing = await stripe.prices.list({ lookup_keys: [tier.lookupKey], limit: 1 })
    if (existing.data[0]) {
      console.log(`✓ Price already exists for ${tier.key}: ${existing.data[0].id}`)
      results[tier.key] = existing.data[0].id
      continue
    }

    const price = await stripe.prices.create({
      currency: CURRENCY,
      lookup_key: tier.lookupKey,
      product_data: { name: tier.productName },
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      tiers: [
        { up_to: tier.includedMinutes, unit_amount: 0 },
        { up_to: "inf", unit_amount: tier.overageCentsPerMinute },
      ],
      recurring: {
        interval: "month",
        usage_type: "metered",
        meter: meter.id,
      },
    })
    console.log(
      `+ Created price for ${tier.key}: ${price.id} (${tier.includedMinutes} min included, then $${(tier.overageCentsPerMinute / 100).toFixed(2)}/min)`
    )
    results[tier.key] = price.id
  }

  console.log("\nAdd these to Vercel env (Production), then you're done — no redeploy needed:\n")
  console.log(`STRIPE_PRICE_AI_MINUTES_PROFESSIONAL=${results.professional}`)
  console.log(`STRIPE_PRICE_AI_MINUTES_BUSINESS=${results.business}`)
}

main().catch((e) => {
  console.error("Setup failed:", e)
  process.exit(1)
})
