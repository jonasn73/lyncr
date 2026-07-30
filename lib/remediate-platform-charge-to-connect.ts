/**
 * One-off / admin helper: move net funds from a platform Charge
 * (no Connect destination) to a connected account via Transfers API.
 *
 * Safe pattern (Stripe docs — separate charges and transfers):
 * - amount = charge balance_transaction.net (after Stripe processing fees)
 * - source_transaction = charge id (ties transfer to that payment)
 * - destination = Connect acct_…
 */

import type Stripe from "stripe"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

export type RemediatePlatformChargeParams = {
  /** Platform charge id (ch_…). */
  chargeId: string
  /** Connected account that should receive the net (acct_…). */
  destinationAccountId: string
  /** Optional idempotency / audit metadata. */
  metadata?: Record<string, string>
  /**
   * If true, also subtract Lyncr’s 2.9%+$0.30 from the net before transferring.
   * Default false for bug remediations (platform misroute — waive Lyncr fee).
   */
  deductLyncrApplicationFee?: boolean
}

export type RemediatePlatformChargeResult =
  | {
      ok: true
      alreadyTransferred: boolean
      transferId: string
      amountCents: number
      chargeId: string
      destinationAccountId: string
      paymentIntentId: string | null
      stripeFeeCents: number
      netCents: number
    }
  | {
      ok: false
      error: string
    }

function computeLyncrFeeCents(chargeCents: number): number {
  const amount = Math.max(0, Math.round(chargeCents))
  if (amount <= 0) return 0
  const fee = Math.round((amount * 290) / 10000) + 30
  return Math.min(amount - 1, Math.max(0, fee))
}

/** List transfers already tied to this charge (idempotency). */
async function findExistingRemediationTransfer(
  stripe: Stripe,
  chargeId: string
): Promise<Stripe.Transfer | null> {
  const listed = await stripe.transfers.list({ limit: 100 })
  const hit = listed.data.find(
    (t) =>
      t.source_transaction === chargeId ||
      t.metadata?.remediation_charge_id === chargeId
  )
  return hit ?? null
}

/**
 * Transfer platform charge net → connected account.
 * Idempotent: re-running returns the existing transfer if one already exists.
 */
export async function remediatePlatformChargeToConnect(
  params: RemediatePlatformChargeParams
): Promise<RemediatePlatformChargeResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." }
  }

  const chargeId = params.chargeId.trim()
  const destinationAccountId = params.destinationAccountId.trim()
  if (!chargeId.startsWith("ch_")) {
    return { ok: false, error: "chargeId must be a Stripe charge id (ch_…)." }
  }
  if (!destinationAccountId.startsWith("acct_")) {
    return { ok: false, error: "destinationAccountId must be a Connect account id (acct_…)." }
  }

  const stripe = getStripeClient()

  const existing = await findExistingRemediationTransfer(stripe, chargeId)
  if (existing) {
    return {
      ok: true,
      alreadyTransferred: true,
      transferId: existing.id,
      amountCents: existing.amount,
      chargeId,
      destinationAccountId: String(existing.destination),
      paymentIntentId: existing.metadata?.payment_intent_id?.trim() || null,
      stripeFeeCents: 0,
      netCents: existing.amount,
    }
  }

  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ["balance_transaction"],
  })

  if (!charge.paid || charge.status !== "succeeded") {
    return { ok: false, error: `Charge ${chargeId} is not a succeeded paid charge.` }
  }
  if (charge.refunded || (charge.amount_refunded ?? 0) > 0) {
    return { ok: false, error: `Charge ${chargeId} was refunded — refusing transfer.` }
  }
  if (charge.destination || charge.transfer_data?.destination) {
    return {
      ok: false,
      error: `Charge ${chargeId} already has a Connect destination — not a platform-stranded charge.`,
    }
  }

  const txn = charge.balance_transaction
  if (!txn || typeof txn === "string") {
    return {
      ok: false,
      error: `Charge ${chargeId} has no expanded balance_transaction yet — try again shortly.`,
    }
  }

  const stripeFeeCents = txn.fee
  const netCents = txn.net
  if (netCents <= 0) {
    return { ok: false, error: `Charge net is ${netCents} — nothing to transfer.` }
  }

  let transferAmount = netCents
  if (params.deductLyncrApplicationFee) {
    const lyncrFee = computeLyncrFeeCents(charge.amount)
    transferAmount = Math.max(0, netCents - lyncrFee)
    if (transferAmount <= 0) {
      return { ok: false, error: "After Lyncr fee there is nothing left to transfer." }
    }
  }

  // Cap at source charge amount (Stripe rule for source_transaction transfers).
  if (transferAmount > charge.amount) {
    return {
      ok: false,
      error: `Transfer amount ${transferAmount} exceeds charge amount ${charge.amount}.`,
    }
  }

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null

  const transfer = await stripe.transfers.create(
    {
      amount: transferAmount,
      currency: charge.currency || "usd",
      destination: destinationAccountId,
      source_transaction: chargeId,
      description:
        charge.description ||
        `Remediate platform charge ${chargeId} → ${destinationAccountId}`,
      metadata: {
        remediation: "platform_charge_to_connect",
        remediation_charge_id: chargeId,
        ...(paymentIntentId ? { payment_intent_id: paymentIntentId } : {}),
        ...(params.metadata || {}),
      },
    },
    {
      // Prevent double-submit races for the same charge.
      idempotencyKey: `remediate-platform-charge:${chargeId}:${destinationAccountId}`,
    }
  )

  return {
    ok: true,
    alreadyTransferred: false,
    transferId: transfer.id,
    amountCents: transfer.amount,
    chargeId,
    destinationAccountId,
    paymentIntentId,
    stripeFeeCents,
    netCents,
  }
}

/** Known stranded Michael pay-link charge (Jul 24, 2026) — Key Squad 502. */
export const MICHAEL_STRANDED_PLATFORM_CHARGE = {
  chargeId: "ch_3TwkBsHkUmpdrLxU1kXdjWgg",
  paymentIntentId: "pi_3TwkBsHkUmpdrLxU1M9j3kQO",
  checkoutSessionId: "cs_live_a1HlhWVOh34SYYfQlSKAzdTZL6QT3K3eSCb40o8tCp78jflDUtQcEvQy96",
  jobId: "094c197d-6847-4f0f-af86-78ae4bf3180a",
  ownerUserId: "7a934861-6ebd-434c-a5ea-3b30b29d6737",
  destinationAccountId: "acct_1TwmlKHcc2l7BNOl",
  customerName: "Michael",
  chargeCents: 25970,
  expectedNetCents: 25187,
} as const
