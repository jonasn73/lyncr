#!/usr/bin/env node
/**
 * One-off: move Michael's stranded $259.70 platform charge net ($251.87) to Connect.
 *
 * What to type in Terminal (from the Lyncr folder):
 *
 *   1. Open Stripe → Developers → API keys → Reveal live secret key (starts with sk_live_)
 *   2. Run (paste your key after the = sign, keep quotes):
 *
 *      cd /Users/JR/Desktop/Lyncr
 *      STRIPE_SECRET_KEY='sk_live_PASTE_HERE' node scripts/remediate-michael-platform-charge.mjs
 *
 * Safe to run twice — Stripe idempotency + existing-transfer check prevent double pay.
 */

const Stripe = require("stripe")

const CHARGE_ID = "ch_3TwkBsHkUmpdrLxU1kXdjWgg"
const DESTINATION = "acct_1TwmlKHcc2l7BNOl"
const EXPECTED_NET = 25187

async function main() {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim()
  if (!key || !key.startsWith("sk_")) {
    console.error("Missing STRIPE_SECRET_KEY. Set it to your live secret key (sk_live_…).")
    process.exit(1)
  }

  const stripe = new Stripe(key)

  // Idempotency: skip if we already transferred this charge.
  const existing = await stripe.transfers.list({ limit: 100 })
  const prior = existing.data.find(
    (t) =>
      t.source_transaction === CHARGE_ID ||
      t.metadata?.remediation_charge_id === CHARGE_ID
  )
  if (prior) {
    console.log(
      JSON.stringify(
        {
          status: "already_done",
          transferId: prior.id,
          amountCents: prior.amount,
          amountDollars: (prior.amount / 100).toFixed(2),
          destination: prior.destination,
        },
        null,
        2
      )
    )
    return
  }

  const charge = await stripe.charges.retrieve(CHARGE_ID, {
    expand: ["balance_transaction"],
  })
  const txn = charge.balance_transaction
  if (!txn || typeof txn === "string") {
    console.error("No balance_transaction on charge yet.")
    process.exit(1)
  }

  const net = txn.net
  console.log(
    JSON.stringify(
      {
        chargeId: charge.id,
        paid: charge.paid,
        amount: charge.amount,
        fee: txn.fee,
        net,
        expectedNet: EXPECTED_NET,
      },
      null,
      2
    )
  )

  if (net !== EXPECTED_NET) {
    console.error(`Net ${net} != expected ${EXPECTED_NET} — aborting for safety.`)
    process.exit(1)
  }
  if (charge.destination || charge.transfer_data?.destination) {
    console.error("Charge already has a Connect destination — aborting.")
    process.exit(1)
  }

  const transfer = await stripe.transfers.create(
    {
      amount: net,
      currency: "usd",
      destination: DESTINATION,
      source_transaction: CHARGE_ID,
      description: "Remediate Michael pay-link (platform → Connect)",
      metadata: {
        remediation: "platform_charge_to_connect",
        remediation_charge_id: CHARGE_ID,
        preset: "michael_jul24_2026",
        job_id: "094c197d-6847-4f0f-af86-78ae4bf3180a",
        owner_user_id: "7a934861-6ebd-434c-a5ea-3b30b29d6737",
        customer_name: "Michael",
        payment_intent_id: "pi_3TwkBsHkUmpdrLxU1M9j3kQO",
      },
    },
    { idempotencyKey: `remediate-platform-charge:${CHARGE_ID}:${DESTINATION}` }
  )

  console.log(
    JSON.stringify(
      {
        status: "transferred",
        transferId: transfer.id,
        amountCents: transfer.amount,
        amountDollars: (transfer.amount / 100).toFixed(2),
        destination: transfer.destination,
        source_transaction: transfer.source_transaction,
        whatYouShouldSee:
          "Open Lyncr → Get paid. Available (or Pending) should show about $251.87, then a bank payout on your normal schedule.",
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
