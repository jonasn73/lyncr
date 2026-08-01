// Platform finance snapshot for admin Ops Home — plain-English money view.

import type Stripe from "stripe"
import { getAdminFinanceNeonSnapshot } from "@/lib/db"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

/** Ops Home “this month” uses US Eastern so evenings don’t flip to next month early (UTC). */
const ADMIN_FINANCE_TZ = "America/New_York"

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.round(cents) / 100)
}

function formatShortDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: ADMIN_FINANCE_TZ,
  }).format(new Date(unixSeconds * 1000))
}

export type PlatformFinanceSnapshot = {
  estimated_mrr_cents: number
  estimated_mrr_label: string
  active_paid_by_tier: { starter: number; professional: number; business: number }
  credit_pack_revenue_mtd_cents: number
  credit_pack_revenue_mtd_label: string
  card_fee_revenue_mtd_cents: number | null
  card_fee_revenue_mtd_label: string
  /** Extra plain-English line under the MTD total (empty-state / last fee / all-time). */
  card_fee_revenue_mtd_detail: string
  card_fee_formula_label: string
  /** Human month window, e.g. "July 2026 (US Eastern)". */
  card_fee_month_label: string
  card_fee_last_at_unix: number | null
  card_fee_last_at_label: string | null
  card_fee_all_time_cents: number | null
  card_fee_all_time_label: string | null
  card_fee_count_mtd: number | null
  stripe_platform_available_cents: number | null
  stripe_platform_pending_cents: number | null
  stripe_platform_available_label: string
  stripe_platform_pending_label: string
  stripe_configured: boolean
}

function zonedYmd(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  return { year: num("year"), month: num("month"), day: num("day") }
}

/** Offset ms such that `utcMs + offset ≈ wall clock as UTC digits` in `timeZone`. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs))
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour"),
    pick("minute"),
    pick("second")
  )
  return asUtc - utcMs
}

/** Unix seconds for local midnight on day 1 of the current month in `timeZone`. */
export function startOfMonthUnixSeconds(timeZone = ADMIN_FINANCE_TZ): number {
  const { year, month } = zonedYmd(new Date(), timeZone)
  // Wall-clock Y-M-01 00:00 as if it were UTC, then subtract the zone offset at that instant.
  const asUtcMidnight = Date.UTC(year, month - 1, 1, 0, 0, 0)
  let instant = asUtcMidnight - timeZoneOffsetMs(asUtcMidnight, timeZone)
  // Recompute offset at the candidate (handles DST edges).
  instant = asUtcMidnight - timeZoneOffsetMs(instant, timeZone)
  return Math.floor(instant / 1000)
}

function cardFeeMonthLabel(timeZone = ADMIN_FINANCE_TZ): string {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date())
  return `${label} (US Eastern)`
}

export function cardFeeFormulaLabel(): string {
  const bpsRaw = Number(process.env.LYNCR_PAYMENT_FEE_BPS ?? "290")
  const flatRaw = Number(process.env.LYNCR_PAYMENT_FEE_FLAT_CENTS ?? "30")
  const bps = Number.isFinite(bpsRaw) && bpsRaw >= 0 ? bpsRaw : 290
  const flat = Number.isFinite(flatRaw) && flatRaw >= 0 ? Math.round(flatRaw) : 30
  const pct = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)
  return `${pct}% + $${(flat / 100).toFixed(2)} per card charge`
}

type CardFeeAgg = {
  mtdCents: number
  mtdCount: number
  allTimeCents: number
  lastAtUnix: number | null
}

/**
 * Sum Connect application fees (Lyncr’s card take).
 * Charges are direct Connect PaymentIntents with application_fee_amount
 * (lib/job-payments.ts / lib/job-pay-link.ts). Stripe docs: use ApplicationFee.amount.
 * balanceTransactions type=application_fee is the fallback if Application Fees API fails.
 */
async function sumApplicationFeesMtd(
  stripe: Stripe,
  gte: number
): Promise<{ cents: number; count: number }> {
  let cents = 0
  let count = 0
  let startingAfter: string | undefined
  for (let page = 0; page < 12; page++) {
    const batch = await stripe.applicationFees.list({
      created: { gte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const fee of batch.data) {
      if ((fee.currency || "").toLowerCase() !== "usd") continue
      const net = Math.max(0, (fee.amount || 0) - (fee.amount_refunded || 0))
      if (net <= 0) continue
      cents += net
      count += 1
    }
    if (!batch.has_more || batch.data.length === 0) break
    startingAfter = batch.data[batch.data.length - 1]?.id
    if (!startingAfter) break
  }
  return { cents, count }
}

async function sumBalanceTxApplicationFeesMtd(
  stripe: Stripe,
  gte: number
): Promise<{ cents: number; count: number }> {
  let cents = 0
  let count = 0
  let startingAfter: string | undefined
  for (let page = 0; page < 12; page++) {
    const batch: Stripe.ApiList<Stripe.BalanceTransaction> = await stripe.balanceTransactions.list({
      type: "application_fee",
      created: { gte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const tx of batch.data) {
      if ((tx.currency || "").toLowerCase() !== "usd") continue
      if (tx.amount <= 0) continue
      cents += tx.amount
      count += 1
    }
    if (!batch.has_more || batch.data.length === 0) break
    startingAfter = batch.data[batch.data.length - 1]?.id
    if (!startingAfter) break
  }

  // Net out fee refunds in the same MTD window (negative amounts).
  startingAfter = undefined
  for (let page = 0; page < 4; page++) {
    const batch: Stripe.ApiList<Stripe.BalanceTransaction> = await stripe.balanceTransactions.list({
      type: "application_fee_refund",
      created: { gte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const tx of batch.data) {
      if ((tx.currency || "").toLowerCase() !== "usd") continue
      cents += tx.amount
    }
    if (!batch.has_more || batch.data.length === 0) break
    startingAfter = batch.data[batch.data.length - 1]?.id
    if (!startingAfter) break
  }

  return { cents: Math.max(0, cents), count }
}

async function fetchLatestAndAllTimeFees(stripe: Stripe): Promise<{
  lastAtUnix: number | null
  allTimeCents: number
}> {
  let lastAtUnix: number | null = null
  let allTimeCents = 0
  let startingAfter: string | undefined
  for (let page = 0; page < 8; page++) {
    const batch = await stripe.applicationFees.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const fee of batch.data) {
      if ((fee.currency || "").toLowerCase() !== "usd") continue
      if (lastAtUnix == null) lastAtUnix = fee.created
      allTimeCents += Math.max(0, (fee.amount || 0) - (fee.amount_refunded || 0))
    }
    if (!batch.has_more || batch.data.length === 0) break
    startingAfter = batch.data[batch.data.length - 1]?.id
    if (!startingAfter) break
  }

  // If Application Fees API returned nothing, peek at latest application_fee BT.
  if (lastAtUnix == null) {
    try {
      const batch = await stripe.balanceTransactions.list({
        type: "application_fee",
        limit: 100,
      })
      for (const tx of batch.data) {
        if ((tx.currency || "").toLowerCase() !== "usd" || tx.amount <= 0) continue
        if (lastAtUnix == null || tx.created > lastAtUnix) lastAtUnix = tx.created
        allTimeCents += tx.amount
      }
    } catch (e) {
      console.warn("[admin-platform-finance] latest BT fees:", e)
    }
  }

  return { lastAtUnix, allTimeCents: Math.max(0, allTimeCents) }
}

async function aggregateConnectCardFees(stripe: Stripe, gte: number): Promise<CardFeeAgg> {
  let mtdCents = 0
  let mtdCount = 0

  // Prefer balanceTransactions type=application_fee — matches platform earnings and
  // stays available even when Application Fees list is empty/restricted.
  try {
    const fromBt = await sumBalanceTxApplicationFeesMtd(stripe, gte)
    mtdCents = fromBt.cents
    mtdCount = fromBt.count
  } catch (e) {
    console.warn("[admin-platform-finance] balanceTransactions MTD:", e)
  }

  if (mtdCents === 0) {
    try {
      const fromFees = await sumApplicationFeesMtd(stripe, gte)
      if (fromFees.cents > mtdCents) {
        mtdCents = fromFees.cents
        mtdCount = fromFees.count
      }
    } catch (e) {
      console.warn("[admin-platform-finance] applicationFees.list MTD:", e)
    }
  }

  let lastAtUnix: number | null = null
  let allTimeCents = 0
  try {
    const meta = await fetchLatestAndAllTimeFees(stripe)
    lastAtUnix = meta.lastAtUnix
    allTimeCents = meta.allTimeCents
  } catch (e) {
    console.warn("[admin-platform-finance] fee meta:", e)
  }

  // All-time should at least cover MTD.
  if (allTimeCents < mtdCents) allTimeCents = mtdCents

  return {
    mtdCents: Math.round(mtdCents),
    mtdCount,
    allTimeCents: Math.round(allTimeCents),
    lastAtUnix,
  }
}

function cardFeeEmptyDetail(agg: CardFeeAgg, monthLabel: string): string {
  if (agg.lastAtUnix != null && agg.allTimeCents > 0) {
    return `No Lyncr card fees in ${monthLabel} yet · Last fee ${formatShortDate(agg.lastAtUnix)} · All-time ${formatUsdFromCents(agg.allTimeCents)}. Platform-only charges (no Connect application_fee) do not create Lyncr fees.`
  }
  if (agg.allTimeCents > 0) {
    return `No Lyncr card fees in ${monthLabel} yet · All-time ${formatUsdFromCents(agg.allTimeCents)}. Platform-only charges do not create Lyncr fees.`
  }
  return `No Lyncr card fees in ${monthLabel} yet. Collect / Tap through Connect creates them; platform-only charges do not.`
}

function cardFeeMtdDetail(agg: CardFeeAgg, monthLabel: string): string {
  if (agg.mtdCents <= 0) return cardFeeEmptyDetail(agg, monthLabel)
  const parts = [`${agg.mtdCount} Connect charge${agg.mtdCount === 1 ? "" : "s"}`, monthLabel]
  if (agg.lastAtUnix != null) parts.push(`Last ${formatShortDate(agg.lastAtUnix)}`)
  return parts.join(" · ")
}

/** Stripe platform account: available/pending + Connect application fee MTD. */
async function fetchStripePlatformFinance(): Promise<
  Pick<
    PlatformFinanceSnapshot,
    | "card_fee_revenue_mtd_cents"
    | "card_fee_revenue_mtd_label"
    | "card_fee_revenue_mtd_detail"
    | "card_fee_month_label"
    | "card_fee_last_at_unix"
    | "card_fee_last_at_label"
    | "card_fee_all_time_cents"
    | "card_fee_all_time_label"
    | "card_fee_count_mtd"
    | "stripe_platform_available_cents"
    | "stripe_platform_pending_cents"
    | "stripe_platform_available_label"
    | "stripe_platform_pending_label"
    | "stripe_configured"
  >
> {
  const monthLabel = cardFeeMonthLabel()
  if (!isStripeConfigured()) {
    return {
      card_fee_revenue_mtd_cents: null,
      card_fee_revenue_mtd_label: "Stripe not configured",
      card_fee_revenue_mtd_detail: "Add STRIPE_SECRET_KEY to load Connect card fees",
      card_fee_month_label: monthLabel,
      card_fee_last_at_unix: null,
      card_fee_last_at_label: null,
      card_fee_all_time_cents: null,
      card_fee_all_time_label: null,
      card_fee_count_mtd: null,
      stripe_platform_available_cents: null,
      stripe_platform_pending_cents: null,
      stripe_platform_available_label: "—",
      stripe_platform_pending_label: "—",
      stripe_configured: false,
    }
  }
  try {
    const stripe = getStripeClient()
    const [balance, feeAgg] = await Promise.all([
      stripe.balance.retrieve(),
      aggregateConnectCardFees(stripe, startOfMonthUnixSeconds()),
    ])
    const available = balance.available
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0)
    const pending = balance.pending
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0)

    return {
      card_fee_revenue_mtd_cents: feeAgg.mtdCents,
      card_fee_revenue_mtd_label: formatUsdFromCents(feeAgg.mtdCents),
      card_fee_revenue_mtd_detail: cardFeeMtdDetail(feeAgg, monthLabel),
      card_fee_month_label: monthLabel,
      card_fee_last_at_unix: feeAgg.lastAtUnix,
      card_fee_last_at_label: feeAgg.lastAtUnix != null ? formatShortDate(feeAgg.lastAtUnix) : null,
      card_fee_all_time_cents: feeAgg.allTimeCents,
      card_fee_all_time_label: formatUsdFromCents(feeAgg.allTimeCents),
      card_fee_count_mtd: feeAgg.mtdCount,
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
      card_fee_revenue_mtd_detail: "Stripe request failed — try Refresh",
      card_fee_month_label: monthLabel,
      card_fee_last_at_unix: null,
      card_fee_last_at_label: null,
      card_fee_all_time_cents: null,
      card_fee_all_time_label: null,
      card_fee_count_mtd: null,
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
