// GET /api/admin/data — metrics + user directory + business P&L (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getLyncrAdminMetrics, listLyncrAdminDirectory, pingNeonDatabase } from "@/lib/db"
import { shouldEnableSentry } from "@/lib/sentry-config"
import { fetchTelnyxRoutingPoolForAdmin } from "@/lib/admin-telnyx-routing-pool"
import { buildPlatformFinanceSnapshot, formatUsdFromCents } from "@/lib/admin-platform-finance"
import {
  listAdminBusinessEconomics,
  parseAdminMoneyPeriod,
} from "@/lib/admin-business-economics"
import type { AdminBusinessEconomics } from "@/lib/types"
import { pingTelnyxApi } from "@/lib/telnyx"
import type { LyncrAdminMetrics } from "@/lib/types"
import { getAdminSupportAlertsByOwner } from "@/lib/admin-support-alerts"

/**
 * Sum per-business rows (already real, already labeled Actual/Est. per field) into three
 * platform totals. No new data source — every input here is a number `listAdminBusinessEconomics`
 * already computed from live Stripe/DB reads for the selected period.
 */
function buildPlatformRollups(rows: AdminBusinessEconomics[]): {
  total_business_wallet_balance_cents: number
  total_business_wallet_balance_label: string
  actual_plan_revenue_period_cents: number
  actual_plan_revenue_period_label: string
  platform_net_period_cents: number
  platform_net_period_label: string
  business_money_period_label: string
  /** What platform_net is actually made of — same four lines the per-business drawer shows, summed. */
  net_breakdown_card_fees_cents: number
  net_breakdown_card_fees_label: string
  net_breakdown_credit_packs_cents: number
  net_breakdown_credit_packs_label: string
  net_breakdown_phone_cost_cents: number
  net_breakdown_phone_cost_label: string
} {
  let walletCents = 0
  let planRevenueCents = 0
  let netCents = 0
  let cardFeeCents = 0
  let creditPackCents = 0
  let phoneCostCents = 0
  for (const row of rows) {
    walletCents += row.collected_wallet_balance_cents
    // Only Stripe-sourced plan cash — a business with no Stripe customer contributes $0 here,
    // same as it does in its own row, rather than inventing a number for it.
    if (row.plan_cash_source === "stripe") planRevenueCents += row.plan_revenue_cents
    netCents += row.net_cents
    cardFeeCents += row.card_fee_mtd_cents
    creditPackCents += row.credit_pack_mtd_cents
    phoneCostCents += row.est_phone_cost_mtd_cents
  }
  return {
    total_business_wallet_balance_cents: walletCents,
    total_business_wallet_balance_label: formatUsdFromCents(walletCents),
    actual_plan_revenue_period_cents: planRevenueCents,
    actual_plan_revenue_period_label: formatUsdFromCents(planRevenueCents),
    platform_net_period_cents: netCents,
    platform_net_period_label: formatUsdFromCents(netCents),
    business_money_period_label: rows[0]?.period_chip_label ?? "All time",
    net_breakdown_card_fees_cents: cardFeeCents,
    net_breakdown_card_fees_label: formatUsdFromCents(cardFeeCents),
    net_breakdown_credit_packs_cents: creditPackCents,
    net_breakdown_credit_packs_label: formatUsdFromCents(creditPackCents),
    net_breakdown_phone_cost_cents: phoneCostCents,
    net_breakdown_phone_cost_label: formatUsdFromCents(phoneCostCents),
  }
}

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    // Optional period for Business money chips (defaults to all_time).
    const period = parseAdminMoneyPeriod(req.nextUrl.searchParams.get("period"))

    const [counts, users, neonOk, telnyxStatus, telnyxRoutingPool, finance, businessEconomics, supportAlerts] =
      await Promise.all([
        getLyncrAdminMetrics(),
        listLyncrAdminDirectory(),
        pingNeonDatabase(),
        pingTelnyxApi(),
        fetchTelnyxRoutingPoolForAdmin(),
        buildPlatformFinanceSnapshot(),
        listAdminBusinessEconomics(period),
        getAdminSupportAlertsByOwner(),
      ])
    const rollups = buildPlatformRollups(businessEconomics)
    const metrics: LyncrAdminMetrics = {
      ...counts,
      telnyx_routing_pool: telnyxRoutingPool,
      health: {
        neon: neonOk ? "ok" : "error",
        telnyx: telnyxStatus,
        sentry: shouldEnableSentry() ? "ok" : "unconfigured",
      },
      finance: { ...finance, ...rollups },
    }
    return NextResponse.json({
      data: {
        metrics,
        users,
        business_economics: businessEconomics,
        support_alerts: Object.fromEntries(supportAlerts),
        period,
      },
    })
  } catch (e) {
    console.error("[lyncr-admin] data:", e)
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 })
  }
}
