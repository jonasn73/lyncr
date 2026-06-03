// GET /api/admin/live-traffic — in-progress calls across all tenants (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listActiveCallTraffic } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const calls = await listActiveCallTraffic()
    return NextResponse.json({ data: { calls, server_time: new Date().toISOString() } })
  } catch (e) {
    console.error("[admin/live-traffic] GET:", e)
    return NextResponse.json({ data: { calls: [], server_time: new Date().toISOString() }, degraded: true })
  }
}
