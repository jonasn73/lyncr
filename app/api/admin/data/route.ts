// GET /api/admin/data — metrics + user directory + business P&L (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getLyncrAdminMetrics, listLyncrAdminDirectory, pingNeonDatabase } from "@/lib/db"
import { shouldEnableSentry } from "@/lib/sentry-config"
import { fetchTelnyxRoutingPoolForAdmin } from "@/lib/admin-telnyx-routing-pool"
import { buildPlatformFinanceSnapshot } from "@/lib/admin-platform-finance"
import {
  listAdminBusinessEconomics,
  parseAdminMoneyPeriod,
} from "@/lib/admin-business-economics"
import { pingTelnyxApi } from "@/lib/telnyx"
import type { LyncrAdminMetrics } from "@/lib/types"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    // Optional period for Business money chips (defaults to all_time).
    const period = parseAdminMoneyPeriod(req.nextUrl.searchParams.get("period"))

    const [counts, users, neonOk, telnyxStatus, telnyxRoutingPool, finance, businessEconomics] =
      await Promise.all([
        getLyncrAdminMetrics(),
        listLyncrAdminDirectory(),
        pingNeonDatabase(),
        pingTelnyxApi(),
        fetchTelnyxRoutingPoolForAdmin(),
        buildPlatformFinanceSnapshot(),
        listAdminBusinessEconomics(period),
      ])
    const metrics: LyncrAdminMetrics = {
      ...counts,
      telnyx_routing_pool: telnyxRoutingPool,
      health: {
        neon: neonOk ? "ok" : "error",
        telnyx: telnyxStatus,
        sentry: shouldEnableSentry() ? "ok" : "unconfigured",
      },
      finance,
    }
    return NextResponse.json({
      data: { metrics, users, business_economics: businessEconomics, period },
    })
  } catch (e) {
    console.error("[lyncr-admin] data:", e)
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 })
  }
}
