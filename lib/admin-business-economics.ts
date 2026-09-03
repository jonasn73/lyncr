// Per-business P&L for Ops Home — actual Stripe cash + fees − phone cost.

import type Stripe from "stripe"
import {
  getAdminBusinessEconomicsRawRows,
  getAdminBusinessEconomicsWalletCharges,
  getAdminBusinessPriorMonthUsage,
  updateOnboardingProfile,
  type AdminBusinessEconomicsRawRow,
  type AdminBusinessPriorUsageRow,
} from "@/lib/db"
import {
  parseAdminMoneyPeriod,
  resolveAdminMoneyPeriodBounds,
  type AdminMoneyPeriod,
  type AdminMoneyPeriodBounds,
} from "@/lib/admin-platform-finance"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { computeLyncrApplicationFeeCents } from "@/lib/stripe-connect"
import type { AdminBusinessEconomics } from "@/lib/types"

/** Rough wholesale Telnyx voice cost (cents/min) — not customer retail. */
const EST_TELNYX_VOICE_CENTS_PER_MINUTE = 2
/** Rough wholesale Telnyx SMS cost (cents/message). */
const EST_TELNYX_SMS_CENTS = 1

const ADMIN_FINANCE_TZ = "America/New_York"

export { parseAdminMoneyPeriod }
export type { AdminMoneyPeriod }

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

/** List-price monthly SaaS in cents — used only for platform MRR estimates elsewhere. */
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

function planTierName(tier: string): string {
  const t = tier.trim().toLowerCase()
  if (t === "professional" || t === "pro") return "Professional"
  if (t === "business" || t === "enterprise") return "Business"
  if (t === "free_trial" || t === "trial") return "Free trial"
  return "Starter"
}

function talkMinutesFromSeconds(seconds: number): number {
  if (seconds <= 0) return 0
  return Math.ceil(seconds / 60)
}

/** Build “We’re ahead/behind by $X” — amount always shown. */
export function buildVerdictLabel(netCents: number): { ahead: boolean; verdict_label: string; net_abs_label: string } {
  const abs = Math.abs(netCents)
  const absLabel = formatUsdFromCents(abs)
  if (netCents === 0) {
    return { ahead: true, verdict_label: `We’re even · ${absLabel}`, net_abs_label: absLabel }
  }
  if (netCents > 0) {
    return { ahead: true, verdict_label: `We’re ahead by ${absLabel}`, net_abs_label: absLabel }
  }
  return { ahead: false, verdict_label: `We’re behind by ${absLabel}`, net_abs_label: absLabel }
}

/**
 * Est. what this shop costs Lyncr on Telnyx this month.
 * Prefer prepaid wallet burn when higher; otherwise minutes×rate + SMS + number buys.
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

type StripeSaasCash = {
  paidMtdCents: number
  lastPaidUnix: number | null
  nextBillUnix: number | null
  subscriptionStatus: string | null
  active: boolean
}

type StripeFeeMaps = {
  byConnectAccount: Map<string, number>
  stripeOk: boolean
}

/** True when `created` Unix seconds falls inside [gte, lt). */
function inPeriodUnix(created: number, gte: number, lt: number | null): boolean {
  if (created < gte) return false
  if (lt != null && created >= lt) return false
  return true
}

/** Pull Connect application fees for a period, grouped by connected account id. */
async function fetchApplicationFeesByConnectAccount(
  stripe: Stripe,
  gte: number,
  lt: number | null
): Promise<Map<string, number>> {
  const map = new Map<string, number>()

  // Prefer Application Fees API — each fee has an `account` (Connect shop).
  try {
    let startingAfter: string | undefined
    for (let page = 0; page < 12; page++) {
      const batch = await stripe.applicationFees.list({
        created: { gte },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const fee of batch.data) {
        if (!inPeriodUnix(fee.created, gte, lt)) continue
        if ((fee.currency || "").toLowerCase() !== "usd") continue
        const net = Math.max(0, (fee.amount || 0) - (fee.amount_refunded || 0))
        if (net <= 0) continue
        const acct =
          typeof fee.account === "string" ? fee.account : fee.account && "id" in fee.account
            ? String((fee.account as { id?: string }).id ?? "")
            : ""
        if (!acct) continue
        map.set(acct, (map.get(acct) ?? 0) + net)
      }
      if (!batch.has_more || batch.data.length === 0) break
      // Stop paging once Stripe returns rows past the exclusive end (list is newest-first).
      const lastCreated = batch.data[batch.data.length - 1]?.created
      if (lt != null && lastCreated != null && lastCreated < gte) break
      startingAfter = batch.data[batch.data.length - 1]?.id
      if (!startingAfter) break
    }
  } catch (e) {
    console.warn("[admin-business-economics] applicationFees.list:", e)
  }

  // Fallback: balanceTransactions descriptions include "(acct_…)".
  if (map.size === 0) {
    try {
      let startingAfter: string | undefined
      for (let page = 0; page < 12; page++) {
        const batch = await stripe.balanceTransactions.list({
          type: "application_fee",
          created: { gte },
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        })
        for (const tx of batch.data) {
          if (!inPeriodUnix(tx.created, gte, lt)) continue
          if ((tx.currency || "").toLowerCase() !== "usd" || tx.amount <= 0) continue
          const match = (tx.description || "").match(/acct_[A-Za-z0-9]+/)
          if (!match) continue
          const acct = match[0]
          map.set(acct, (map.get(acct) ?? 0) + tx.amount)
        }
        if (!batch.has_more || batch.data.length === 0) break
        startingAfter = batch.data[batch.data.length - 1]?.id
        if (!startingAfter) break
      }
    } catch (e) {
      console.warn("[admin-business-economics] balanceTransactions fees:", e)
    }
  }

  return map
}

/** Actual SaaS cash paid in the period + subscription status from Stripe. */
async function fetchSaasCashForCustomer(
  stripe: Stripe,
  customerId: string,
  subscriptionId: string | null,
  gte: number,
  lt: number | null
): Promise<StripeSaasCash> {
  let paidMtdCents = 0
  let lastPaidUnix: number | null = null
  let nextBillUnix: number | null = null
  let subscriptionStatus: string | null = null
  let active = false

  try {
    // Paid invoices created in window = cash Lyncr actually collected.
    let startingAfter: string | undefined
    for (let page = 0; page < 4; page++) {
      const batch = await stripe.invoices.list({
        customer: customerId,
        status: "paid",
        created: { gte },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const inv of batch.data) {
        if (!inPeriodUnix(inv.created, gte, lt)) continue
        if ((inv.currency || "").toLowerCase() !== "usd") continue
        const paid = inv.amount_paid ?? 0
        if (paid > 0) paidMtdCents += paid
        const paidAt = inv.status_transitions?.paid_at ?? inv.created
        if (paidAt != null && (lastPaidUnix == null || paidAt > lastPaidUnix)) {
          lastPaidUnix = paidAt
        }
      }
      if (!batch.has_more || batch.data.length === 0) break
      startingAfter = batch.data[batch.data.length - 1]?.id
      if (!startingAfter) break
    }

    // Most recent paid invoice ever (for “last paid” when $0 this period).
    if (lastPaidUnix == null) {
      const recent = await stripe.invoices.list({
        customer: customerId,
        status: "paid",
        limit: 5,
      })
      for (const inv of recent.data) {
        const paidAt = inv.status_transitions?.paid_at ?? inv.created
        if (paidAt != null && (inv.amount_paid ?? 0) > 0) {
          if (lastPaidUnix == null || paidAt > lastPaidUnix) lastPaidUnix = paidAt
        }
      }
    }
  } catch (e) {
    console.warn("[admin-business-economics] invoices:", customerId, e)
  }

  // Subscription status drives active flag + next bill (or none).
  const subId = subscriptionId?.trim() || null
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId)
      subscriptionStatus = sub.status
      active = sub.status === "active" || sub.status === "trialing"
      if (active && sub.current_period_end) {
        nextBillUnix = sub.current_period_end
      } else {
        nextBillUnix = null
      }
    } catch (e) {
      console.warn("[admin-business-economics] subscription:", subId, e)
    }
  } else {
    // No sub id — check if any active subscription exists on the customer.
    try {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 5,
      })
      const live = subs.data.find((s) => s.status === "active" || s.status === "trialing")
      const any = live ?? subs.data[0]
      if (any) {
        subscriptionStatus = any.status
        active = any.status === "active" || any.status === "trialing"
        nextBillUnix = active && any.current_period_end ? any.current_period_end : null
      }
    } catch (e) {
      console.warn("[admin-business-economics] subscriptions.list:", customerId, e)
    }
  }

  return { paidMtdCents, lastPaidUnix, nextBillUnix, subscriptionStatus, active }
}

/** Soft-fix Neon when Stripe says canceled/unpaid but Neon still says active. */
async function syncNeonSubscriptionFlagIfStale(
  userId: string,
  neonActive: boolean,
  stripeActive: boolean,
  hadStripeIds: boolean
): Promise<void> {
  if (!hadStripeIds) return
  if (neonActive && !stripeActive) {
    try {
      await updateOnboardingProfile(userId, { has_active_subscription: false })
    } catch (e) {
      console.warn("[admin-business-economics] neon sync inactive:", userId, e)
    }
  } else if (!neonActive && stripeActive) {
    try {
      await updateOnboardingProfile(userId, { has_active_subscription: true })
    } catch (e) {
      console.warn("[admin-business-economics] neon sync active:", userId, e)
    }
  }
}

function buildPlanStatusLabel(opts: {
  active: boolean
  status: string | null
  tier: string
  lastPaidUnix: number | null
  nextBillUnix: number | null
  paidMtdCents: number
  hasStripe: boolean
}): string {
  const last = opts.lastPaidUnix != null ? formatShortDate(opts.lastPaidUnix) : "never"
  const next =
    opts.nextBillUnix != null ? formatShortDate(opts.nextBillUnix) : "none"
  const tierName = planTierName(opts.tier)

  if (!opts.hasStripe) {
    return opts.active
      ? `${tierName} · Neon says active (no Stripe customer — not cash)`
      : "No paid plan on file"
  }

  if (opts.status === "canceled" || opts.status === "unpaid" || opts.status === "incomplete_expired") {
    return `Subscription canceled · last paid ${last} · next bill: none`
  }
  if (opts.active) {
    const cashNote =
      opts.paidMtdCents > 0
        ? `Stripe collected ${formatUsdFromCents(opts.paidMtdCents)} this month`
        : "No Stripe payment this month yet"
    return `${tierName} · ${cashNote} · next bill ${next}`
  }
  if (opts.status === "past_due") {
    return `Past due · last paid ${last} · next bill: ${next}`
  }
  return `Subscription ${opts.status ?? "unknown"} · last paid ${last} · next bill: ${next}`
}

function assembleRow(
  row: AdminBusinessEconomicsRawRow,
  saas: StripeSaasCash | null,
  cardFeeMtdCents: number,
  cardFeeSource: AdminBusinessEconomics["card_fee_source"],
  bounds: AdminMoneyPeriodBounds,
  priorNote: string | null
): AdminBusinessEconomics {
  const hasStripeIds = Boolean(row.stripe_customer_id || row.stripe_subscription_id)

  // Trust Stripe when we have customer/sub ids — never invent list-price cash.
  const planCents = saas?.paidMtdCents ?? 0
  const stripeActive = saas?.active ?? false
  const displayActive = hasStripeIds ? stripeActive : row.has_active_subscription

  const phone = estimatePhoneCostCents(row)
  const creditPack = row.credit_pack_mtd_cents
  const netCents = planCents + cardFeeMtdCents + creditPack - phone.cents
  const verdict = buildVerdictLabel(netCents)
  const minutes = talkMinutesFromSeconds(row.talk_seconds_mtd)

  const planStatus = buildPlanStatusLabel({
    active: displayActive,
    status: saas?.subscriptionStatus ?? null,
    tier: row.subscription_tier,
    lastPaidUnix: saas?.lastPaidUnix ?? null,
    nextBillUnix: saas?.nextBillUnix ?? null,
    paidMtdCents: planCents,
    hasStripe: hasStripeIds,
  })

  // Plain-English phrase used in breakdown notes under each money line.
  const periodPhrase =
    bounds.period === "all_time"
      ? "all time"
      : bounds.period === "this_year"
        ? "this year"
        : bounds.period === "last_30_days"
          ? "last 30 days"
          : bounds.period === "last_month"
            ? "last month"
            : "this month"

  const notes: string[] = []
  if (hasStripeIds) {
    notes.push(
      `Plan dollars are what Stripe actually collected ${periodPhrase} (paid invoices) — not list price.`
    )
  } else {
    notes.push("No Stripe customer on file — plan cash shown as $0 (we do not invent list-price MRR).")
  }
  if (cardFeeSource === "stripe") {
    notes.push(`Card fees are real Stripe Connect application fees for this shop ${periodPhrase}.`)
  } else if (cardFeeSource === "estimate") {
    notes.push(
      "Card fees estimated from completed Collect/Tap charges (2.9% + $0.30) — Stripe attribution unavailable."
    )
  }
  if (phone.method === "wallet_burn") {
    notes.push(`Phone cost uses prepaid wallet burn ${periodPhrase} (billing_ledger).`)
  } else {
    notes.push(
      `Est. phone cost ≈ ${minutes} talk min × $${(EST_TELNYX_VOICE_CENTS_PER_MINUTE / 100).toFixed(2)} + SMS + number buys (wholesale proxy from call_logs / SMS — not Telnyx invoice).`
    )
  }
  if (priorNote) {
    notes.push(priorNote)
  }

  const lastPaidLabel =
    saas?.lastPaidUnix != null ? formatShortDate(saas.lastPaidUnix) : null
  const nextBillLabel =
    displayActive && saas?.nextBillUnix != null
      ? formatShortDate(saas.nextBillUnix)
      : hasStripeIds
        ? "none"
        : null

  return {
    user_id: row.user_id,
    business_name: row.business_name,
    email: row.email,
    subscription_tier: row.subscription_tier,
    has_active_subscription: displayActive,
    plan_revenue_cents: planCents,
    plan_revenue_label: formatUsdFromCents(planCents),
    plan_tier_label: displayActive
      ? `${planTierName(row.subscription_tier)} (active)`
      : hasStripeIds
        ? `${planTierName(row.subscription_tier)} (not collecting)`
        : "No paid plan",
    plan_status_label: planStatus,
    plan_cash_source: hasStripeIds ? "stripe" : "none",
    saas_last_paid_label: lastPaidLabel,
    saas_next_bill_label: nextBillLabel,
    stripe_subscription_status: saas?.subscriptionStatus ?? null,
    est_phone_cost_mtd_cents: phone.cents,
    est_phone_cost_mtd_label: formatUsdFromCents(phone.cents),
    phone_cost_is_estimate: phone.method !== "wallet_burn",
    card_fee_mtd_cents: cardFeeMtdCents,
    card_fee_mtd_label: formatUsdFromCents(cardFeeMtdCents),
    card_fee_source: cardFeeSource,
    credit_pack_mtd_cents: creditPack,
    credit_pack_mtd_label: formatUsdFromCents(creditPack),
    net_cents: netCents,
    net_abs_label: verdict.net_abs_label,
    net_label: formatUsdFromCents(netCents),
    ahead: verdict.ahead,
    verdict_label: verdict.verdict_label,
    month_label: bounds.label,
    period: bounds.period,
    period_chip_label: bounds.chip_label,
    prior_period_note: priorNote,
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
    collected_wallet_balance_cents: row.collected_wallet_balance_cents,
    collected_wallet_balance_label: formatUsdFromCents(row.collected_wallet_balance_cents),
  }
}

function cardFeesByUserEstimate(
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

async function loadStripeFeeMaps(
  gte: number,
  lt: number | null
): Promise<StripeFeeMaps> {
  if (!isStripeConfigured()) {
    return { byConnectAccount: new Map(), stripeOk: false }
  }
  try {
    const stripe = getStripeClient()
    const byConnectAccount = await fetchApplicationFeesByConnectAccount(stripe, gte, lt)
    return { byConnectAccount, stripeOk: true }
  } catch (e) {
    console.warn("[admin-business-economics] stripe fees:", e)
    return { byConnectAccount: new Map(), stripeOk: false }
  }
}

async function loadSaasByCustomer(
  rows: AdminBusinessEconomicsRawRow[],
  gte: number,
  lt: number | null
): Promise<Map<string, StripeSaasCash>> {
  const out = new Map<string, StripeSaasCash>()
  if (!isStripeConfigured()) return out

  const stripe = getStripeClient()
  const customers = [
    ...new Set(
      rows
        .map((r) => r.stripe_customer_id?.trim())
        .filter((id): id is string => Boolean(id))
    ),
  ]

  await Promise.all(
    customers.map(async (customerId) => {
      const row = rows.find((r) => r.stripe_customer_id === customerId)
      const saas = await fetchSaasCashForCustomer(
        stripe,
        customerId,
        row?.stripe_subscription_id ?? null,
        gte,
        lt
      )
      out.set(customerId, saas)
    })
  )
  return out
}

/** Build “Showing August only · July had 550 calls / $23.02 card fees”. */
export function buildPriorPeriodNote(opts: {
  currentMonthLabel: string
  priorMonthLabel: string
  prior: AdminBusinessPriorUsageRow | null | undefined
  priorCardFeeCents: number | null
}): string | null {
  const prior = opts.prior
  if (!prior || (prior.call_count <= 0 && prior.sms_count <= 0 && (opts.priorCardFeeCents ?? 0) <= 0)) {
    return null
  }
  const minutes = talkMinutesFromSeconds(prior.talk_seconds)
  const parts: string[] = []
  if (prior.call_count > 0) {
    parts.push(`${prior.call_count} call${prior.call_count === 1 ? "" : "s"}`)
  }
  if (minutes > 0) {
    parts.push(`${minutes} talk min`)
  }
  if (prior.sms_count > 0) {
    parts.push(`${prior.sms_count} SMS`)
  }
  if ((opts.priorCardFeeCents ?? 0) > 0) {
    parts.push(`${formatUsdFromCents(opts.priorCardFeeCents!)} card fees`)
  }
  if (parts.length === 0) return null
  // Strip " (US Eastern)" for a shorter month name in the note.
  const currentShort = opts.currentMonthLabel.replace(/\s*\(US Eastern\)\s*$/i, "")
  const priorShort = opts.priorMonthLabel.replace(/\s*\(US Eastern\)\s*$/i, "")
  // Point them at Last month or All time so August zeros don’t look like “no money ever.”
  return `Showing ${currentShort} only · ${priorShort} had ${parts.join(" / ")} — tap Last month or All time to see that money.`
}

/** All owner businesses with P&L for the selected period (Stripe actuals + Neon usage). */
export async function listAdminBusinessEconomics(
  period: AdminMoneyPeriod = "all_time"
): Promise<AdminBusinessEconomics[]> {
  const bounds = resolveAdminMoneyPeriodBounds(period)
  // Only when viewing This month: load last month so we can show a cross-period hint banner.
  const priorBounds =
    period === "this_month" ? resolveAdminMoneyPeriodBounds("last_month") : null

  const [rows, charges, feeMaps, priorUsage, priorFeeMaps] = await Promise.all([
    getAdminBusinessEconomicsRawRows({ gteIso: bounds.gteIso, ltIso: bounds.ltIso }),
    getAdminBusinessEconomicsWalletCharges({ gteIso: bounds.gteIso, ltIso: bounds.ltIso }),
    loadStripeFeeMaps(bounds.gteUnix, bounds.ltUnix),
    priorBounds
      ? getAdminBusinessPriorMonthUsage({
          gteIso: priorBounds.gteIso,
          ltIso: priorBounds.ltIso!,
        })
      : Promise.resolve([] as AdminBusinessPriorUsageRow[]),
    priorBounds
      ? loadStripeFeeMaps(priorBounds.gteUnix, priorBounds.ltUnix)
      : Promise.resolve({ byConnectAccount: new Map<string, number>(), stripeOk: false }),
  ])

  const saasByCustomer = await loadSaasByCustomer(rows, bounds.gteUnix, bounds.ltUnix)
  const estimatedFees = cardFeesByUserEstimate(charges)
  const priorByUser = new Map(priorUsage.map((p) => [p.user_id, p]))

  // Soft-sync Neon flags when Stripe disagrees (best-effort, non-blocking display).
  await Promise.all(
    rows.map(async (row) => {
      const cust = row.stripe_customer_id?.trim()
      if (!cust) return
      const saas = saasByCustomer.get(cust)
      if (!saas) return
      await syncNeonSubscriptionFlagIfStale(
        row.user_id,
        row.has_active_subscription,
        saas.active,
        true
      )
    })
  )

  return rows.map((row) => {
    const cust = row.stripe_customer_id?.trim() ?? null
    const saas = cust ? saasByCustomer.get(cust) ?? null : null

    let cardFee = 0
    let cardSource: AdminBusinessEconomics["card_fee_source"] = "none"
    const connectId = row.stripe_connect_account_id?.trim()
    if (connectId && feeMaps.stripeOk) {
      cardFee = feeMaps.byConnectAccount.get(connectId) ?? 0
      cardSource = "stripe"
    } else if (!feeMaps.stripeOk) {
      cardFee = estimatedFees.get(row.user_id) ?? 0
      cardSource = cardFee > 0 ? "estimate" : "none"
    } else {
      // Stripe ok but this shop has no Connect account / no fees this period.
      cardFee = 0
      cardSource = connectId ? "stripe" : "none"
    }

    let priorNote: string | null = null
    if (period === "this_month" && priorBounds) {
      const prior = priorByUser.get(row.user_id)
      const priorFee =
        connectId && priorFeeMaps.stripeOk
          ? priorFeeMaps.byConnectAccount.get(connectId) ?? 0
          : null
      // Only nudge when this month looks empty but last month had real activity.
      if (
        row.call_count_mtd === 0 &&
        row.sms_count_mtd === 0 &&
        cardFee === 0 &&
        (prior?.call_count || prior?.sms_count || (priorFee ?? 0) > 0)
      ) {
        priorNote = buildPriorPeriodNote({
          currentMonthLabel: bounds.label,
          priorMonthLabel: priorBounds.label,
          prior: prior ?? null,
          priorCardFeeCents: priorFee,
        })
      }
    }

    return assembleRow(row, saas, cardFee, cardSource, bounds, priorNote)
  })
}

/** One business P&L — null if not found. */
export async function getAdminBusinessEconomics(
  userId: string,
  period: AdminMoneyPeriod = "all_time"
): Promise<AdminBusinessEconomics | null> {
  const all = await listAdminBusinessEconomics(period)
  return all.find((r) => r.user_id === userId) ?? null
}
