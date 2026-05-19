/**
 * One-off: sync Stripe subscription for jonasn73@gmail.com after missed webhook.
 * Run: npx tsx scripts/sync-stripe-subscription.ts jonasn73@gmail.com
 */
import Stripe from "stripe"
import { neon } from "@neondatabase/serverless"

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error("Usage: npx tsx scripts/sync-stripe-subscription.ts user@email.com")
  process.exit(1)
}

const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
const dbUrl = process.env.DATABASE_URL?.trim()
if (!stripeKey || !dbUrl) {
  console.error("Set STRIPE_SECRET_KEY and DATABASE_URL")
  process.exit(1)
}

const stripe = new Stripe(stripeKey)
const sql = neon(dbUrl)

async function main() {
  const users = await sql`SELECT id, email FROM users WHERE lower(email) = ${email} LIMIT 1`
  const user = users[0] as { id: string; email: string } | undefined
  if (!user) {
    console.error("User not found:", email)
    process.exit(1)
  }

  const customers = await stripe.customers.list({ email, limit: 20 })
  let synced = false

  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: 20,
    })
    for (const sub of subs.data) {
      const metaUserId = sub.metadata?.user_id?.trim()
      if (metaUserId && metaUserId !== user.id) continue

      const periodStart = sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null
      const periodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null

      await sql`
        INSERT INTO onboarding_profiles (
          user_id, has_active_subscription, billing_cycle_start, billing_cycle_end,
          stripe_customer_id, stripe_subscription_id, updated_at
        )
        VALUES (
          ${user.id}, true, ${periodStart}, ${periodEnd},
          ${customer.id}, ${sub.id}, NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          has_active_subscription = true,
          billing_cycle_start = EXCLUDED.billing_cycle_start,
          billing_cycle_end = EXCLUDED.billing_cycle_end,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          updated_at = NOW()
      `

      console.log("Synced subscription", sub.id, "for", email)
      synced = true
      break
    }
    if (synced) break
  }

  if (!synced) {
    console.error("No active Stripe subscription found for", email)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
