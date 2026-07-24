import type Stripe from "stripe"
import { getStripeClient } from "@/lib/stripe-config"
import {
  adminAdjustUserCreditBalance,
  billingLedgerHasEntry,
  getUser,
  updateUserBillingPlan,
} from "@/lib/db"
import { type BillingPlanKey, TELNYX_NUMBER_PURCHASE_CENTS } from "@/lib/billing-pricing"
import { billingPlanKeyFromSubscriptionTier, type SubscriptionTier } from "@/lib/subscription-tier"
import { syncTelnyxCarrierWalletAfterCreditPurchase } from "@/lib/telnyx-billing"
import { resolveUserIdFromStripeCheckoutSession } from "@/lib/stripe-user-resolve"
import {
  syncStripeSubscriptionToNeon,
  provisionReservedLineAfterStripePayment,
} from "@/lib/stripe-webhook-sync"

async function creditPackAlreadyApplied(userId: string, sessionId: string): Promise<boolean> {
  return billingLedgerHasEntry(userId, sessionId, "stripe_credit_pack")
}

export async function setUserBillingPlan(userId: string, plan: BillingPlanKey): Promise<void> {
  await updateUserBillingPlan(userId, plan)
}

/** Sync users.billing_plan from subscription_tier after Stripe webhook. */
export async function applySubscriptionTierToUser(userId: string, tier: SubscriptionTier): Promise<void> {
  const plan = billingPlanKeyFromSubscriptionTier(tier) as BillingPlanKey
  await setUserBillingPlan(userId, plan)
}

/** Credit the user's prepaid balance after a Stripe credit-pack checkout. */
export async function applyStripeCreditPackPayment(
  userId: string,
  session: Stripe.Checkout.Session
): Promise<{ balance_after_cents: number; telnyx_message: string }> {
  const cents = Number(session.metadata?.credit_cents ?? session.amount_total ?? 0)
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error("Credit pack checkout missing credit_cents metadata.")
  }

  if (await creditPackAlreadyApplied(userId, session.id)) {
    const user = await getUser(userId)
    return {
      balance_after_cents: Number(user?.credit_balance_cents ?? 0),
      telnyx_message: "Credit already applied for this checkout.",
    }
  }

  const { balance_after_cents } = await adminAdjustUserCreditBalance({
    target_user_id: userId,
    delta_cents: cents,
    reason: "stripe_credit_pack",
    actor_user_id: userId,
    reference: session.id,
    meta: {
      payment_intent: session.payment_intent,
      amount_usd: cents / 100,
    },
  })

  const telnyx = await syncTelnyxCarrierWalletAfterCreditPurchase(cents / 100)
  return { balance_after_cents, telnyx_message: telnyx.message }
}

/** Route completed checkout sessions — subscription or one-time credit pack. */
export async function handleStripeCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = resolveUserIdFromStripeCheckoutSession(session)
  if (!userId) {
    console.error("[stripe] checkout.session.completed missing user_id / client_reference_id", session.id)
    return
  }

  const checkoutType = session.metadata?.checkout_type?.trim() || "subscription"

  if (checkoutType === "tendlc_registration") {
    if (session.payment_status !== "paid" && session.status !== "complete") return
    const { handleMessaging10DlcPaid } = await import("@/lib/messaging-10dlc")
    await handleMessaging10DlcPaid(userId, session.id)
    return
  }

  if (checkoutType === "booking_deposit") {
    if (session.payment_status !== "paid" && session.status !== "complete") return
    const { fulfillBookingDepositFromCheckout } = await import("@/lib/booking-deposit")
    await fulfillBookingDepositFromCheckout(session)
    return
  }

  if (checkoutType === "job_payment_link" || checkoutType === "adhoc_payment_link") {
    if (session.payment_status !== "paid" && session.status !== "complete") return
    const { fulfillCollectPayLinkFromCheckout } = await import("@/lib/job-pay-link")
    await fulfillCollectPayLinkFromCheckout(session)
    return
  }

  if (checkoutType === "credit_pack") {
    if (session.payment_status !== "paid" && session.status !== "complete") return
    await applyStripeCreditPackPayment(userId, session)
    const provision = await provisionReservedLineAfterStripePayment(userId)
    if (!provision.ok) {
      console.error("[stripe] provision after credit pack failed:", provision.error)
    }
    return
  }

  if (session.mode !== "subscription") return
  if (session.payment_status !== "paid" && session.status !== "complete") return

  const subRef = session.subscription
  const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id
  if (!subscriptionId) return

  const stripe = getStripeClient()
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  await syncStripeSubscriptionToNeon(userId, subscription, {
    customerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
  })
}

export function userHasCarrierCreditForNumberPurchase(creditBalanceCents: number): boolean {
  return creditBalanceCents >= TELNYX_NUMBER_PURCHASE_CENTS
}
