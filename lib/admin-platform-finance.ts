// Platform finance snapshot for admin Ops Home — plain-English money view.

import Stripe from "stripe"
import { getSql, isUndefinedRelationError } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { CHECKOUT_TIER_OPTIONS } from "@/lib/subscription-checkout"

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.round(cents) / 100)
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export type PlatformFinanceSnapshot = {
  /** Estimated monthly SaaS from active paid tiers (list prices). */
  estimated_mrr_cents: number
  estimated_mrr_label: string
  active_paid_by_tier: { starter: number; professional: number; business: number }
  /** Money users paid Lyncr for phone credit packs this calendar month (USD cents). */
  credit_pack_revenue_mtd_cents: number
  credit_pack_revenue_mtd_label: string
  /** Lyncr application fees collected this month (card Collect payments). */
  card_fee_revenue_mtd_cents: number | null
  card_fee_revenue_mtd_label: string
  /** Effective fee copy, e.g. "2.9% + $0.30 per card charge". */
  card_fee_formula_label: string
  /** Platform Stripe balance (Lyncr's Stripe account, not Connect shops). */
  stripe_platform_available_cents: number | null
  stripe_platform_pending_cents: number | null
  stripe_platform_available_label: string
  stripe_platform_pending_label: string
  stripe_configured: boolean
}

function cardFeeFormulaLabel(): string {
  const bpsRaw = Number(process.env.LYNCR_PAYMENT_FEE_BPS ?? "290")
  const flatRaw = Number(process.env.LYNCR_PAYMENT_FEE_FLAT_CENTS ?? "30")
  const bps = Number.isFinite(bpsRaw) && bpsRaw >= 0 ? bpsRaw : 290
  const flat = Number.isFinite(flatRaw) && flatRaw >= 0 ? Math.round(flatRaw) : 30
  const pct = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)
  return `${pct}% + $${(flat / 100).toFixed(2)} per card charge`
}

function startOfMonthUnixSeconds(): number {
  const now = new Date()
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000)
}

/** Neon: estimated MRR + credit-pack cash-in MTD. */
export async function fetchNeonPlatformFinance(): Promise<
  Pick<
    PlatformFinanceSnapshot,
    | "estimated_mrr_cents"
    | "estimated_mrr_label"
    | "active_paid_by_tier"
    | "credit_pack_revenue_mtd_cents"
    | "credit_pack_revenue_mtd_label"
  >
> {
  const empty = {
    estimated_mrr_cents: 0,
    estimated_mrr_label: formatUsdFromCents(0),
    active_paid_by_tier: { starter: 0, professional: 0, business: 0 },
    credit_pack_revenue_mtd_cents: 0,
    credit_pack_revenue_mtd_label: formatUsdFromCents(0),
  }
  const sql = getSql()
  try {
    const tierRows = await sql`
      SELECT lower(coalesce(nullif(trim(subscription_tier), ''), 'starter')) AS tier,
             count(*)::int AS n
      FROM onboarding_profiles
      WHERE has_active_subscription = true
      GROUP BY 1
    `
    const byTier = { starter: 0, professional: 0, business: 0 }
    for (const raw of tierRows as { tier?: string; n?: number }[]) {
      const t = String(raw.tier ?? "starter")
      const n = Number(raw.n ?? 0)
      if (t === "professional" || t === "pro") byTier.professional += n
      else if (t === "business" || t === "enterprise") byTier.business += n
      else if (t !== "free_trial" && t !== "trial") byTier.starter += n
    }
    let mrr = 0
    for (const opt of CHECKOUT_TIER_OPTIONS) {
      mrr += byTier[opt.tier] * opt.monthlyCents
    }

    let creditPackMtd = 0
    try {
      const packRows = await sql`
        SELECT coalesce(sum(delta_cents), 0)::bigint AS cents
        FROM billing_ledger
        WHERE reason = 'stripe_credit_pack'
          AND delta_cents > 0
          AND created_at >= date_trunc('month', now())
      `
      creditPackMtd = Number((packRows[0] as { cents?: number })?.cents ?? 0)
    } catch (e) {
      if (!isUndefinedRelationError(e, "billing_ledger")) throw e
    }

    return {
      estimated_mrr_cents: mrr,
      estimated_mrr_label: formatUsdFromCents(mrr),
      active_paid_by_tier: byTier,
      credit_pack_revenue_mtd_cents: creditPackMtd,
      credit_pack_revenue_mtd_label: formatUsdFromCents(creditPackMtd),
    }
  } catch {
    return empty
  }
}

/** Stripe platform account: available/pending + application fee MTD. */
export async function fetchStripePlatformFinance(): Promise<
  Pick<
    PlatformFinanceSnapshot,
    | "card_fee_revenue_mtd_cents"
    | "card_fee_revenue_mtd_label"
    | "stripe_platform_available_cents"
    | "stripe_platform_pending_cents"
    | "stripe_platform_available_label"
    | "stripe_platform_pending_label"
    | "stripe_configured"
  >
> {
  const formula = cardFeeFormulaLabel()
  if (!isStripeConfigured()) {
    return {
      card_fee_revenue_mtd_cents: null,
      card_fee_revenue_mtd_label: "Stripe not configured",
      stripe_platform_available_cents: null,
      stripe_platform_pending_cents: null,
      stripe_platform_available_label: "—",
      stripe_platform_pending_label: "—",
      stripe_configured: false,
    }
  }
  try {
    const stripe = getStripeClient()
    const balance = await stripe.balance.retrieve()
    const available = balance.available
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0)
    const pending = balance.pending
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0)

    let feeMtd = 0
    const gte = startOfMonthUnixSeconds()
    let startingAfter: string | undefined
    // Cap pages so Home stays snappy.
    for (let page = 0; page < 8; page++) {
      const batch: Stripe.ApiList<Stripe.BalanceTransaction> = await stripe.balanceTransactions.list({
        type: "application_fee",
        created: { gte },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const tx of batch.data) {
        if (tx.currency === "usd" && tx.amount > 0) feeMtd += tx.amount
      }
      if (!batch.has_more || batch.data.length === 0) break
      startingAfter = batch.data[batch.data.length - 1]?.id
      if (!startingAfter) break
    }

    return {
      card_fee_revenue_mtd_cents: feeMtd,
      card_fee_revenue_mtd_label: formatUsdFromCents(feeMtd),
      stripe_platform_available_cents: available,
      stripe_platform_pending_cents: pending,
      stripe_platform_available_label: formatUsdFromCents(available),
      stripe_platform_pending_label: formatUsdFromCents(pending),
      stripe_configured: true,
    }
  } catch (e) {
    console.error("[admin-platform-finance] stripe:", e)
    return {
      card_fee_revenue_mtd_cents: null,
      card_fee_revenue_mtd_label: "Could not load",
      stripe_platform_available_cents: null,
      stripe_platform_pending_cents: null,
      stripe_platform_available_label: "—",
      stripe_platform_pending_label: "—",
      stripe_configured: true,
    }
  }
}

export async function buildPlatformFinanceSnapshot(): Promise<PlatformFinanceSnapshot> {
  const [neon, stripe] = await Promise.all([fetchNeonPlatformFinance(), fetchStripePlatformFinance()])
  return {
    ...neon,
    ...stripe,
    card_fee_formula_label: cardFeeFormulaLabel(),
  }
}

export { formatUsd, formatUsdFromCents, cardFeeFormulaLabel }
