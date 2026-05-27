import { NextResponse } from "next/server"
import { requireSessionUser } from "@/lib/admin-api-guard"
import { getOnboardingProfile } from "@/lib/db"
import {
  BILLING_PLAN_ORDER,
  CREDIT_PACK_CENTS_USD,
  DEFAULT_PAID_PLAN,
  METERED_VOICE_CENTS_PER_MINUTE,
  PLAN_INCLUDED_MINUTES_PER_MONTH,
  PLAN_MONTHLY_PRICE_CENTS,
  billingPlanKeyFromSubscriptionTier,
  formatUsdFromCents,
  type BillingPlanKey,
} from "@/lib/billing-pricing"
import { hasEnoughCarrierCredit } from "@/lib/subscription-tier"
import {
  LOW_CARRIER_CREDIT_THRESHOLD_USD,
} from "@/lib/carrier-credit-threshold"
import {
  CARRIER_PROVISIONING_FEE_USD,
  TIER_DISPLAY_NAME,
  normalizeSubscriptionTier,
  tierActiveNumberLimit,
} from "@/lib/subscription-tier"

export async function GET(req: Request) {
  try {
    const ctx = await requireSessionUser(req)
    if (ctx instanceof NextResponse) return ctx
    const profile = await getOnboardingProfile(ctx.user.id)
    const hasPaidSubscription = Boolean(profile?.stripe_subscription_id?.trim())
    const subscriptionTier = normalizeSubscriptionTier(profile?.subscription_tier)
    const planFromProfile = billingPlanKeyFromSubscriptionTier(subscriptionTier, hasPaidSubscription)
    const legacyPlan = (ctx.user.billing_plan || "trial") as BillingPlanKey
    const safePlan: BillingPlanKey = hasPaidSubscription
      ? planFromProfile
      : BILLING_PLAN_ORDER.includes(legacyPlan)
        ? legacyPlan
        : "trial"
    const plans = BILLING_PLAN_ORDER.map((key) => ({
      key,
      monthly_price_cents: PLAN_MONTHLY_PRICE_CENTS[key],
      monthly_price_label: formatUsdFromCents(PLAN_MONTHLY_PRICE_CENTS[key]),
      included_minutes_per_month: PLAN_INCLUDED_MINUTES_PER_MONTH[key],
    }))
    const balanceCents = Number(ctx.user.credit_balance_cents) || 0
    const carrierCreditUsd = Number(profile?.carrier_credit ?? balanceCents / 100)
    const needsCarrierCredit =
      hasPaidSubscription && !hasEnoughCarrierCredit(carrierCreditUsd > 0 ? carrierCreditUsd : balanceCents / 100)
    const lowBalanceNotified = profile?.low_balance_notified === true
    const lowCarrierCreditWarning =
      lowBalanceNotified && carrierCreditUsd < LOW_CARRIER_CREDIT_THRESHOLD_USD

    return NextResponse.json({
      data: {
        current_plan: safePlan,
        default_paid_plan: DEFAULT_PAID_PLAN,
        credit_balance_cents: balanceCents,
        credit_balance_label: formatUsdFromCents(balanceCents),
        carrier_credit_usd: carrierCreditUsd,
        carrier_credit_label: formatUsdFromCents(Math.round(carrierCreditUsd * 100)),
        subscription_tier: subscriptionTier,
        subscription_tier_label: TIER_DISPLAY_NAME[subscriptionTier],
        subscription_active: hasPaidSubscription,
        stripe_subscription_id: profile?.stripe_subscription_id?.trim() || null,
        needs_carrier_credit: needsCarrierCredit,
        low_balance_notified: lowBalanceNotified,
        low_carrier_credit_warning: lowCarrierCreditWarning,
        low_carrier_credit_threshold_usd: LOW_CARRIER_CREDIT_THRESHOLD_USD,
        active_number_limit: tierActiveNumberLimit(subscriptionTier),
        telnyx_number_purchase_label: formatUsdFromCents(Math.round(CARRIER_PROVISIONING_FEE_USD * 100)),
        metered_voice_cents_per_minute: METERED_VOICE_CENTS_PER_MINUTE,
        suggested_credit_packs_cents: [...CREDIT_PACK_CENTS_USD],
        plans,
      },
    })
  } catch (e) {
    console.error("[billing/summary]", e)
    return NextResponse.json({ error: "Billing unavailable" }, { status: 500 })
  }
}
