// GET /api/admin/call-quality — platform-wide call health (admin@lyncr.app only).
// Missed rate, setup/post-dial latency, and top failure routes across all tenants.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getPlatformCallHealthSummary } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const daysParam = Number(req.nextUrl.searchParams.get("days"))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 30) : 7

  try {
    const data = await getPlatformCallHealthSummary(days)
    return NextResponse.json({ data })
  } catch (e) {
    console.error("[admin/call-quality] GET:", e)
    return NextResponse.json({ error: "Failed to load call quality" }, { status: 500 })
  }
}
