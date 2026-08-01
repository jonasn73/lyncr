// Per-business P&L for Ops Home — SaaS + card fees − est. Telnyx cost.

import {
  getAdminBusinessEconomicsRawRows,
  getAdminBusinessEconomicsWalletCharges,
  type AdminBusinessEconomicsRawRow,
} from "@/lib/db"
import { computeLyncrApplicationFeeCents } from "@/lib/stripe-connect"
import type { AdminBusinessEconomics } from "@/lib/types"

/** Rough wholesale Telnyx voice cost (cents/min) — not customer retail. */
const EST_TELNYX_VOICE_CENTS_PER_MINUTE = 2
/** Rough wholesale Telnyx SMS cost (cents/message). */
const EST_TELNYX_SMS_CENTS = 1

const ADMIN_FINANCE_TZ = "America/New_York"

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.round(cents) / 100)
}

function monthLabelEastern(): string {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: ADMIN_FINANCE_TZ,
    month: "long",
    year: "numeric",
  }).format(new Date())
  return `${label} (US Eastern)`
}

/** List-price monthly SaaS in cents from onboarding tier. */
export function planRevenueCentsForTier(
  tier: string,
  hasActiveSubscription: boolean
): number {
  if (!hasActiveSubscription) return 0
  const t = tier.trim().toLowerCase()
  if (t === "professional" || t === "pro") return 4900
  if (t === "business" || t === "enterprise") return 9900
  if (t === "free_trial" || t === "trial") return 0
  return 1900 // starter / unknown paid
}

function planTierLabel(tier: string, hasActiveSubscription: boolean): string {
  if (!hasActiveSubscription) return "No paid plan"
  const t = tier.trim().toLowerCase()
  if (t === "professional" || t === "pro") return "Professional · $49/mo"
  if (t === "business" || t === "enterprise") return "Business · $99/mo"
  if (t === "free_trial" || t === "trial") return "Free trial"
  return "Starter · $19/mo"
}

function talkMinutesFromSeconds(seconds: number): number {
  if (seconds <= 0) return 0
  return Math.ceil(seconds / 60)
}

/**
 * Est. what this shop costs Lyncr on Telnyx this month.
 * Prefer usage estimate (minutes × rate + SMS + number buys); if prepaid
 * wallet burn is higher, use that (still labeled as an estimate).
 */
function estimatePhoneCostCents(row: AdminBusinessEconomicsRawRow): {
  cents: number
  method: AdminBusinessEconomics["phone_cost_method"]
  usageEstimateCents: number
} {
  const minutes = talkMinutesFromSeconds(row.talk_seconds_mtd)
  const usageEstimateCents =
    minutes * EST_TELNYX_VOICE_CENTS_PER_MINUTE +
    row.sms_count_mtd * EST_TELNYX_SMS_CENTS +
    row.number_purchase_mtd_cents

  if (row.wallet_burn_mtd_cents > usageEstimateCents && row.wallet_burn_mtd_cents > 0) {
    return {
      cents: row.wallet_burn_mtd_cents,
      method: "wallet_burn",
      usageEstimateCents,
    }
  }
  if (usageEstimateCents > 0 && row.wallet_burn_mtd_cents > 0) {
    return { cents: usageEstimateCents, method: "mixed", usageEstimateCents }
  }
  return { cents: usageEstimateCents, method: "estimate_minutes", usageEstimateCents }
}

function assembleRow(
  row: AdminBusinessEconomicsRawRow,
  cardFeeMtdCents: number,
  month: string
): AdminBusinessEconomics {
  const planCents = planRevenueCentsForTier(row.subscription_tier, row.has_active_subscription)
  const phone = estimatePhoneCostCents(row)
  const creditPack = row.credit_pack_mtd_cents
  // Revenue Lyncr keeps − est. carrier cost for this shop this month.
  const netCents = planCents + cardFeeMtdCents + creditPack - phone.cents
  const ahead = netCents >= 0
  const minutes = talkMinutesFromSeconds(row.talk_seconds_mtd)

  const notes: string[] = []
  if (phone.method === "wallet_burn") {
    notes.push(
      "Phone cost uses prepaid wallet burn this month (higher than the minutes×rate estimate)."
    )
  } else {
    notes.push(
      `Est. phone cost ≈ ${minutes} talk min × $${(EST_TELNYX_VOICE_CENTS_PER_MINUTE / 100).toFixed(2)} + SMS + number buys (wholesale proxy, not Telnyx invoice).`
    )
  }
  if (cardFeeMtdCents > 0) {
    notes.push("Card fees estimated from completed Collect/Tap charges (2.9% + $0.30 each).")
  }

  return {
    user_id: row.user_id,
    business_name: row.business_name,
    email: row.email,
    subscription_tier: row.subscription_tier,
    has_active_subscription: row.has_active_subscription,
    plan_revenue_cents: planCents,
    plan_revenue_label: formatUsdFromCents(planCents),
    plan_tier_label: planTierLabel(row.subscription_tier, row.has_active_subscription),
    est_phone_cost_mtd_cents: phone.cents,
    est_phone_cost_mtd_label: formatUsdFromCents(phone.cents),
    card_fee_mtd_cents: cardFeeMtdCents,
    card_fee_mtd_label: formatUsdFromCents(cardFeeMtdCents),
    credit_pack_mtd_cents: creditPack,
    credit_pack_mtd_label: formatUsdFromCents(creditPack),
    net_cents: netCents,
    net_label: formatUsdFromCents(netCents),
    ahead,
    verdict_label: ahead ? "We’re ahead" : "We’re behind",
    month_label: month,
    talk_minutes_mtd: minutes,
    call_count_mtd: row.call_count_mtd,
    sms_count_mtd: row.sms_count_mtd,
    wallet_burn_mtd_cents: row.wallet_burn_mtd_cents,
    wallet_burn_mtd_label: formatUsdFromCents(row.wallet_burn_mtd_cents),
    number_purchase_mtd_cents: row.number_purchase_mtd_cents,
    number_purchase_mtd_label: formatUsdFromCents(row.number_purchase_mtd_cents),
    phone_cost_method: phone.method,
    carrier_credit_usd: row.carrier_credit,
    stripe_connect_account_id: row.stripe_connect_account_id,
    breakdown_notes: notes,
  }
}

function cardFeesByUser(
  charges: { user_id: string; amount_usd: number }[]
): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of charges) {
    const cents = Math.round(Number(c.amount_usd) * 100)
    if (!Number.isFinite(cents) || cents <= 0) continue
    const fee = computeLyncrApplicationFeeCents(cents)
    map.set(c.user_id, (map.get(c.user_id) ?? 0) + fee)
  }
  return map
}

/** All owner businesses with this-month P&L (Neon + fee formula). */
export async function listAdminBusinessEconomics(): Promise<AdminBusinessEconomics[]> {
  const month = monthLabelEastern()
  const [rows, charges] = await Promise.all([
    getAdminBusinessEconomicsRawRows(),
    getAdminBusinessEconomicsWalletCharges(),
  ])
  const fees = cardFeesByUser(charges)
  return rows.map((row) => assembleRow(row, fees.get(row.user_id) ?? 0, month))
}

/** One business P&L — null if not found. */
export async function getAdminBusinessEconomics(
  userId: string
): Promise<AdminBusinessEconomics | null> {
  const all = await listAdminBusinessEconomics()
  return all.find((r) => r.user_id === userId) ?? null
}
