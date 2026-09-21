// GET /api/admin/call-history — call history across all tenants, searchable (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listRecentCallHistory } from "@/lib/db"

export const dynamic = "force-dynamic"

const DEFAULT_LIMIT = 50

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? ""
  const parsedLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10)
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT

  try {
    const calls = await listRecentCallHistory({ limit, search })
    return NextResponse.json({ data: { calls, server_time: new Date().toISOString() } })
  } catch (e) {
    console.error("[admin/call-history] GET:", e)
    return NextResponse.json(
      { data: { calls: [], server_time: new Date().toISOString() }, degraded: true },
      { status: 200 }
    )
  }
}
