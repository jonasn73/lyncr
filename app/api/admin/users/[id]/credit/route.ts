// ============================================
// POST /api/admin/users/[id]/credit
// ============================================
// Adjust prepaid balance (cents) and append billing_ledger.

import { NextRequest, NextResponse } from "next/server"
import { adminAdjustUserCreditBalance } from "@/lib/db"
import { requirePlatformAdmin } from "@/lib/admin-api-guard"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requirePlatformAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id: targetUserId } = await params
  try {
    const body = await req.json()
    const deltaCents = Number(body?.delta_cents)
    const reason = String(body?.reason ?? "").trim()
    if (!Number.isFinite(deltaCents) || deltaCents === 0) {
      return NextResponse.json({ error: "delta_cents must be a non-zero number" }, { status: 400 })
    }
    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json({ error: "reason must be 3–500 characters" }, { status: 400 })
    }
    const result = await adminAdjustUserCreditBalance({
      target_user_id: targetUserId,
      delta_cents: deltaCents,
      reason,
      actor_user_id: ctx.userId,
      reference: body?.reference != null ? String(body.reference) : null,
      meta: typeof body?.meta === "object" && body.meta != null ? (body.meta as Record<string, unknown>) : undefined,
    })
    return NextResponse.json({ data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Credit adjustment failed"
    if (msg.includes("019-billing-admin-feedback")) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    console.error("[Sigo] admin credit:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
