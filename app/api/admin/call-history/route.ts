// GET /api/admin/call-history — most recent 50 calls across all tenants (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listRecentCallHistory } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const calls = await listRecentCallHistory(50)
    return NextResponse.json({ data: { calls, server_time: new Date().toISOString() } })
  } catch (e) {
    console.error("[admin/call-history] GET:", e)
    return NextResponse.json(
      { data: { calls: [], server_time: new Date().toISOString() }, degraded: true },
      { status: 200 }
    )
  }
}
