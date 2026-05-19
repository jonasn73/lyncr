import type Stripe from "stripe"
import {
  getOnboardingProfile,
  getPhoneNumbers,
  getUser,
  insertPhoneNumber,
  normalizePhoneNumberE164,
  syncOnboardingLineToPhoneNumbers,
  updateOnboardingProfile,
  updatePhoneNumber,
} from "@/lib/db"
import { purchaseAndConfigureTelnyxLine } from "@/lib/telnyx-purchase-line"

function stripePeriodToIso(unixSec: number | null | undefined): string | null {
  if (unixSec == null || !Number.isFinite(unixSec)) return null
  return new Date(unixSec * 1000).toISOString()
}

function resolveUserIdFromStripeObject(obj: {
  metadata?: Stripe.Metadata | null
  client_reference_id?: string | null
}): string | null {
  const fromMeta = obj.metadata?.user_id?.trim()
  if (fromMeta) return fromMeta
  const ref = obj.client_reference_id?.trim()
  return ref || null
}

/** Buy reserved DID on Telnyx after Stripe payment — always live, skips simulation gate. */
export async function provisionReservedLineAfterStripePayment(userId: string): Promise<void> {
  const profile = await getOnboardingProfile(userId)
  if (!profile?.reserved_number?.trim()) return

  if (profile.reserved_number_method === "port") {
    await syncOnboardingLineToPhoneNumbers(userId, profile)
    return
  }

  const normalized = normalizePhoneNumberE164(profile.reserved_number)
  const existing = await getPhoneNumbers(userId)
  const row = existing.find((r) => normalizePhoneNumberE164(r.number) === normalized)
  if (row?.provider_number_sid?.trim()) return

  const purchase = await purchaseAndConfigureTelnyxLine(normalized)
  if (!purchase.ok) {
    throw new Error(purchase.error)
  }

  const user = await getUser(userId)
  const label = user?.business_name?.trim() || "Business Line"
  const friendly = profile.reserved_number_display?.trim() || purchase.phone_number

  if (row) {
    await updatePhoneNumber(row.id, userId, {
      provider_number_sid: purchase.order_id,
      status: "active",
    })
    return
  }

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

  await updateOnboardingProfile(userId, {
    has_active_subscription: true,
    billing_cycle_start: periodStart,
    billing_cycle_end: periodEnd,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
  })

  await provisionReservedLineAfterStripePayment(userId)
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
