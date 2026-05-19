import type Stripe from "stripe"
import { normalizeCheckoutSubscriptionTier } from "@/lib/subscription-checkout"
import { normalizeSubscriptionTier, subscriptionTierFromStripePriceId, type SubscriptionTier } from "@/lib/subscription-tier"
import {
  adjustUserCarrierCredit,
  getOnboardingProfile,
  getPhoneNumbers,
  getUser,
  insertPhoneNumber,
  normalizePhoneNumberE164,
  syncOnboardingLineToPhoneNumbers,
  updateOnboardingProfile,
  updatePhoneNumber,
} from "@/lib/db"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  CARRIER_PROVISIONING_FEE_USD,
  hasEnoughCarrierCredit,
} from "@/lib/subscription-tier"
import { purchaseAndConfigureTelnyxLine } from "@/lib/telnyx-purchase-line"
import { evaluateNumberProvisionGate } from "@/lib/number-allocation"
import {
  extractUsAreaCode,
  type ProvisionLineResult,
} from "@/lib/provision-line-types"
import { resolveUserIdFromStripeObject } from "@/lib/stripe-user-resolve"

export type { ProvisionLineResult } from "@/lib/provision-line-types"

/** Read subscription tier from Stripe subscription line items. */
export function resolveSubscriptionTierFromStripeSubscription(
  subscription: Stripe.Subscription
): SubscriptionTier | null {
  for (const item of subscription.items?.data ?? []) {
    const priceRef = item.price
    const priceId = typeof priceRef === "string" ? priceRef : priceRef?.id
    const tier = subscriptionTierFromStripePriceId(priceId)
    if (tier) return tier
  }
  const metaTier = subscription.metadata?.subscription_tier ?? subscription.metadata?.plan
  if (metaTier) {
    return normalizeSubscriptionTier(normalizeCheckoutSubscriptionTier(metaTier))
  }
  return null
}

function stripePeriodToIso(unixSec: number | null | undefined): string | null {
  if (unixSec == null || !Number.isFinite(unixSec)) return null
  return new Date(unixSec * 1000).toISOString()
}

export { resolveUserIdFromStripeObject } from "@/lib/stripe-user-resolve"

function mapPurchaseFailure(
  requestedE164: string,
  purchase: { ok: false; error: string; reason?: string }
): ProvisionLineResult {
  if (purchase.reason === "number_unavailable") {
    return {
      ok: false,
      reason: "number_unavailable",
      unavailable_number: requestedE164,
      area_code: extractUsAreaCode(requestedE164),
      error: purchase.error,
    }
  }
  if (purchase.reason === "area_empty") {
    return {
      ok: false,
      reason: "number_unavailable",
      unavailable_number: requestedE164,
      area_code: extractUsAreaCode(requestedE164),
      error: purchase.error,
    }
  }
  return { ok: false, reason: "carrier_error", error: purchase.error }
}

/**
 * Buy the user's chosen DID on Telnyx after subscription + carrier credit are ready.
 * Never auto-substitutes — if the exact number is unavailable, returns `number_unavailable` so the UI can ask the user to pick another.
 * Carrier credit ($2) is deducted only after Telnyx confirms the purchase.
 */
export async function provisionReservedLineAfterStripePayment(
  userId: string,
  opts?: { phoneNumberE164?: string }
): Promise<ProvisionLineResult> {
  const profile = await getOnboardingProfile(userId)
  if (!profile?.reserved_number?.trim() && !opts?.phoneNumberE164?.trim()) {
    return { ok: false, reason: "not_configured", error: "No reserved business line on file." }
  }

  const requestedRaw = opts?.phoneNumberE164?.trim() || profile!.reserved_number!.trim()
  const normalized = normalizePhoneNumberE164(requestedRaw)
  if (!normalized.replace(/\D/g, "").length) {
    return { ok: false, reason: "not_configured", error: "Invalid business line on file." }
  }

  if (profile?.reserved_number_method === "port" && !opts?.phoneNumberE164?.trim()) {
    await syncOnboardingLineToPhoneNumbers(userId, profile)
    return { ok: true, phone_number: profile.reserved_number!, user_confirmed_number: false }
  }

  const existing = await getPhoneNumbers(userId)
  const row =
    existing.find((r) => normalizePhoneNumberE164(r.number) === normalized) ??
    existing.find((r) => !r.provider_number_sid?.trim())
  if (row?.provider_number_sid?.trim() && normalizePhoneNumberE164(row.number) === normalized) {
    return { ok: true, phone_number: row.number, user_confirmed_number: Boolean(opts?.phoneNumberE164) }
  }

  const userConfirmed = Boolean(opts?.phoneNumberE164?.trim())
  if (userConfirmed || normalizePhoneNumberE164(profile?.reserved_number ?? "") !== normalized) {
    await updateOnboardingProfile(userId, {
      reserved_number: normalized,
      reserved_number_display: formatPhoneDisplay(normalized),
      reserved_number_method: "buy",
    })
    await syncOnboardingLineToPhoneNumbers(userId, {
      ...profile!,
      reserved_number: normalized,
      reserved_number_display: formatPhoneDisplay(normalized),
      reserved_number_method: "buy",
    }).catch(() => null)
  }

  const provisionGate = await evaluateNumberProvisionGate(userId, normalized)
  if (!provisionGate.allowed) {
    return {
      ok: false,
      reason: provisionGate.reason === "insufficient_credit" ? "insufficient_credit" : "tier_limit",
      error: provisionGate.message,
    }
  }

  const user = await getUser(userId)
  const profileCredit = provisionGate.carrier_credit
  const legacyCents = Number(user?.credit_balance_cents ?? 0)
  const carrierCreditUsd = profileCredit > 0 ? profileCredit : legacyCents / 100
  if (!hasEnoughCarrierCredit(carrierCreditUsd)) {
    return {
      ok: false,
      reason: "insufficient_credit",
      error: `Add at least $${CARRIER_PROVISIONING_FEE_USD.toFixed(2)} carrier credit on the Pay tab before we can purchase your line.`,
    }
  }

  const purchase = await purchaseAndConfigureTelnyxLine(normalized)
  if (!purchase.ok) {
    return mapPurchaseFailure(normalized, purchase)
  }

  await adjustUserCarrierCredit({
    userId,
    deltaUsd: -CARRIER_PROVISIONING_FEE_USD,
    reason: "carrier_number_purchase",
    reference: purchase.order_id,
    meta: { phone_number: purchase.phone_number, requested_number: normalized },
  })

  await updateOnboardingProfile(userId, {
    reserved_number: purchase.phone_number,
    reserved_number_display: formatPhoneDisplay(purchase.phone_number),
  })

  const label = user?.business_name?.trim() || "Business Line"
  const friendly = formatPhoneDisplay(purchase.phone_number)

  if (row) {
    await updatePhoneNumber(row.id, userId, {
      number: purchase.phone_number,
      friendly_name: friendly,
      provider_number_sid: purchase.order_id,
      status: "active",
    })
  } else {
    await insertPhoneNumber({
      user_id: userId,
      number: purchase.phone_number,
      friendly_name: friendly,
      label,
      type: "local",
      status: "active",
      provider_number_sid: purchase.order_id,
    })
  }

  return {
    ok: true,
    phone_number: purchase.phone_number,
    user_confirmed_number: userConfirmed,
  }
}

/** Apply Stripe subscription billing state to Neon and provision Telnyx. */
export async function syncStripeSubscriptionToNeon(
  userId: string,
  subscription: Stripe.Subscription,
  opts?: { customerId?: string | null }
): Promise<void> {
  const periodStart = stripePeriodToIso(subscription.current_period_start)
  const periodEnd = stripePeriodToIso(subscription.current_period_end)
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? opts?.customerId ?? null

  const tier =
    resolveSubscriptionTierFromStripeSubscription(subscription) ??
    (subscription.status === "active" || subscription.status === "trialing" ? "starter" : "free_trial")

  if (tier === "free_trial") {
    return
  }

  await updateOnboardingProfile(userId, {
    has_active_subscription: true,
    subscription_tier: tier,
    billing_cycle_start: periodStart,
    billing_cycle_end: periodEnd,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
  })

  const { applySubscriptionTierToUser } = await import("@/lib/stripe-billing-sync")
  await applySubscriptionTierToUser(userId, tier)

  const provision = await provisionReservedLineAfterStripePayment(userId)
  if (!provision.ok) {
    console.error("[stripe] Telnyx provision after payment failed:", provision.error, provision.reason)
  }
}

export async function handleStripeSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  const userId = resolveUserIdFromStripeObject(subscription)
  if (!userId) {
    console.error("[stripe] subscription.created missing user_id metadata", subscription.id)
    return
  }
  if (subscription.status === "incomplete" || subscription.status === "incomplete_expired") {
    return
  }
  await syncStripeSubscriptionToNeon(userId, subscription)
}

export async function handleStripeInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const subRef = invoice.subscription
  const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id
  if (!subscriptionId) return

  const { getStripeClient } = await import("@/lib/stripe-config")
  const stripe = getStripeClient()
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  let userId = resolveUserIdFromStripeObject(invoice)
  if (!userId) userId = resolveUserIdFromStripeObject(subscription)
  if (!userId) {
    console.error("[stripe] invoice.payment_succeeded missing user_id metadata", invoice.id)
    return
  }
  await syncStripeSubscriptionToNeon(userId, subscription, {
    customerId: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id,
  })
}
