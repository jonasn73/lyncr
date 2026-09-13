// GET /api/admin/hold-queue-health — platform-wide hold-queue health (admin@lyncr.app only).
// Answered/abandoned rates, wait times, and Phase-1/2 intake capture across all tenants.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getPlatformHoldQueueHealthSummary } from "@/lib/call-queue-db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const daysParam = Number(req.nextUrl.searchParams.get("days"))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 30) : 7

  try {
    const data = await getPlatformHoldQueueHealthSummary(days)
    return NextResponse.json({ data })
  } catch (e) {
    console.error("[admin/hold-queue-health] GET:", e)
    return NextResponse.json({ error: "Failed to load hold-queue health" }, { status: 500 })
  }
}
