// Stripe refund / dispute webhooks → wallet reversals (scripts/154).
//
// Money is credited the moment a card clears, so the wallet has to give it back the moment
// Stripe takes it away — otherwise the total overstates the business from the first chargeback.
// Each handler is idempotent through recordWalletReversal, which keys on the Stripe event id.

import type Stripe from "stripe"
import { recordWalletReversal, sumReversedForPaymentIntent, type WalletReversalReason } from "@/lib/tech-wallet"
import { getOnboardingProfile, getUser } from "@/lib/db"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

/**
 * Text the owner the instant money leaves (or returns to) the wallet outside of anything they
 * did themselves — a refund or dispute is a surprise by nature, so silence until they happen to
 * open the app is the wrong default. Best-effort: never lets a notification failure affect
 * whether the reversal itself was recorded (that already happened by the time this runs).
 */
async function notifyOwnerWalletReversal(params: {
  ownerUserId: string | null
  amountUsd: number
  reason: WalletReversalReason
}): Promise<void> {
  if (!params.ownerUserId) return
  try {
    const [profile, user] = await Promise.all([
      getOnboardingProfile(params.ownerUserId),
      getUser(params.ownerUserId),
    ])
    const to = resolveLeadAlertSmsRecipient(profile, user)
    if (!to) return

    const dollars = Math.abs(params.amountUsd).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    })
    const what =
      params.reason === "DISPUTE_WON"
        ? `${dollars} was returned to your wallet — you won a dispute.`
        : params.reason === "DISPUTE"
          ? `${dollars} was taken from your wallet — a customer disputed a charge.`
          : `${dollars} was refunded and taken back out of your wallet.`

    await sendTelnyxSms({ toE164: to, text: `Lyncr: ${what}`, userId: params.ownerUserId })
  } catch (e) {
    console.warn("[wallet-reversals] owner notification failed", e)
  }
}

/** Stripe hands back either an expanded object or a bare id depending on the event. */
function idOf(ref: string | { id: string } | null | undefined): string {
  if (!ref) return ""
  return typeof ref === "string" ? ref : String(ref.id || "")
}

/**
 * charge.refunded fires for the FIRST refund and again for every later one, and
 * `amount_refunded` is cumulative, not per-refund. Reversing that figure each time would
 * subtract the first refund twice. Take back only what has not been taken back yet, and key
 * the row on the cumulative total so a redelivery of the same event is a no-op while a genuine
 * second partial refund is not.
 */
export async function handleStripeChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = idOf(charge.payment_intent)
  if (!paymentIntentId) return

  const refundedUsd = Math.round(Number(charge.amount_refunded || 0)) / 100
  if (refundedUsd <= 0) return

  const alreadyReversed = await sumReversedForPaymentIntent(paymentIntentId, "REFUND")
  const outstanding = Math.round((refundedUsd - alreadyReversed) * 100) / 100
  if (outstanding <= 0) return

  const tx = await recordWalletReversal({
    stripePaymentIntentId: paymentIntentId,
    reversalEventId: `${charge.id}:refund:${charge.amount_refunded}`,
    amountUsd: outstanding,
    reason: "REFUND",
  })
  if (tx) {
    await notifyOwnerWalletReversal({ ownerUserId: tx.ownerUserId, amountUsd: outstanding, reason: "REFUND" })
  }
}

/**
 * Stripe withdraws the disputed amount from the connected account the moment a dispute opens,
 * before anyone has decided anything. The wallet follows the bank rather than the outcome, so
 * the number matches what the business can actually spend today.
 */
export async function handleStripeDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const paymentIntentId = idOf(dispute.payment_intent)
  if (!paymentIntentId) return

  const amountUsd = Math.round(Number(dispute.amount || 0)) / 100
  if (amountUsd <= 0) return

  const tx = await recordWalletReversal({
    stripePaymentIntentId: paymentIntentId,
    reversalEventId: dispute.id,
    amountUsd,
    reason: "DISPUTE",
  })
  if (tx) {
    await notifyOwnerWalletReversal({ ownerUserId: tx.ownerUserId, amountUsd, reason: "DISPUTE" })
  }
}

/**
 * Won disputes return the funds, so the hold taken at dispute.created is put back. A lost or
 * withdrawn dispute needs nothing — the money already left and stays gone.
 */
export async function handleStripeDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  if (dispute.status !== "won") return

  const paymentIntentId = idOf(dispute.payment_intent)
  if (!paymentIntentId) return

  const amountUsd = Math.round(Number(dispute.amount || 0)) / 100
  if (amountUsd <= 0) return

  const tx = await recordWalletReversal({
    stripePaymentIntentId: paymentIntentId,
    // Distinct from the dispute.created key so the re-credit is its own idempotent row.
    reversalEventId: `${dispute.id}:won`,
    amountUsd,
    reason: "DISPUTE_WON",
  })
  if (tx) {
    await notifyOwnerWalletReversal({ ownerUserId: tx.ownerUserId, amountUsd, reason: "DISPUTE_WON" })
  }
}
