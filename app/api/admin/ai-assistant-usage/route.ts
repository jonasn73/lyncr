// GET /api/admin/ai-assistant-usage — per-account AI Assistant hold-bridge minutes (`087`).
// Optional ?days= window (default 30). Admin only.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listAdminAiAssistantHoldUsage } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const daysRaw = Number(req.nextUrl.searchParams.get("days") || "30")
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30
    const accounts = await listAdminAiAssistantHoldUsage(days)
    return NextResponse.json({ data: { accounts, days } })
  } catch (e) {
    console.error("[admin/ai-assistant-usage] GET:", e)
    return NextResponse.json({ error: "Failed to load AI assistant usage" }, { status: 500 })
  }
}
