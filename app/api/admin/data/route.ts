// GET /api/admin/data — metrics + user directory in one request (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getLyncrAdminMetrics, listLyncrAdminDirectory, pingNeonDatabase } from "@/lib/db"
import { fetchTelnyxRoutingPoolForAdmin } from "@/lib/admin-telnyx-routing-pool"
import { pingTelnyxApi } from "@/lib/telnyx"
import type { LyncrAdminMetrics } from "@/lib/types"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const [counts, users, neonOk, telnyxStatus, telnyxRoutingPool] = await Promise.all([
      getLyncrAdminMetrics(),
      listLyncrAdminDirectory(),
      pingNeonDatabase(),
      pingTelnyxApi(),
      fetchTelnyxRoutingPoolForAdmin(),
    ])
    const metrics: LyncrAdminMetrics = {
      ...counts,
      telnyx_routing_pool: telnyxRoutingPool,
      health: {
        neon: neonOk ? "ok" : "error",
        telnyx: telnyxStatus,
      },
    }
    return NextResponse.json({ data: { metrics, users } })
  } catch (e) {
    console.error("[lyncr-admin] data:", e)
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 })
  }
}
