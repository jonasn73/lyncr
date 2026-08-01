// Platform finance snapshot for admin Ops Home — plain-English money view.

import type Stripe from "stripe"
import { getAdminFinanceNeonSnapshot } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.round(cents) / 100)
}

export type PlatformFinanceSnapshot = {
  estimated_mrr_cents: number
  estimated_mrr_label: string
  active_paid_by_tier: { starter: number; professional: number; business: number }
  credit_pack_revenue_mtd_cents: number
  credit_pack_revenue_mtd_label: string
  card_fee_revenue_mtd_cents: number | null
  card_fee_revenue_mtd_label: string
  card_fee_formula_label: string
  stripe_platform_available_cents: number | null
  stripe_platform_pending_cents: number | null
  stripe_platform_available_label: string
  stripe_platform_pending_label: string
  stripe_configured: boolean
}

export function cardFeeFormulaLabel(): string {
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

/** Stripe platform account: available/pending + application fee MTD. */
async function fetchStripePlatformFinance(): Promise<
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
  const [neon, stripe] = await Promise.all([getAdminFinanceNeonSnapshot(), fetchStripePlatformFinance()])
  return {
    estimated_mrr_cents: neon.estimated_mrr_cents,
    estimated_mrr_label: formatUsdFromCents(neon.estimated_mrr_cents),
    active_paid_by_tier: neon.active_paid_by_tier,
    credit_pack_revenue_mtd_cents: neon.credit_pack_revenue_mtd_cents,
    credit_pack_revenue_mtd_label: formatUsdFromCents(neon.credit_pack_revenue_mtd_cents),
    ...stripe,
    card_fee_formula_label: cardFeeFormulaLabel(),
  }
}
