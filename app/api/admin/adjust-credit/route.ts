// POST /api/admin/adjust-credit — atomically adjust onboarding_profiles.carrier_credit (admin only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminAdjustProfileCarrierCredit } from "@/lib/db"

function parseUserId(body: Record<string, unknown>): string {
  return String(body.userId ?? body.user_id ?? "").trim()
}

function parseAmount(body: Record<string, unknown>): number {
  return Number(body.amount ?? body.delta_usd ?? body.amount_usd ?? body.delta)
}

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = (await req.json()) as Record<string, unknown>
    const userId = parseUserId(body)
    const amount = parseAmount(body)
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "amount must be a non-zero number" }, { status: 400 })
    }
    const result = await adminAdjustProfileCarrierCredit({ userId, amountUsd: amount })
    return NextResponse.json({ data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Credit adjustment failed"
    console.error("[lyncr-admin] adjust-credit:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
