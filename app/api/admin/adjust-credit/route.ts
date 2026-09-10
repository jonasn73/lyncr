// POST /api/admin/adjust-credit — admin@lyncr.app only; atomic carrier_credit update.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminAdjustProfileCarrierCredit } from "@/lib/db"
import { recordAuditEvent } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json()) as Record<string, unknown>
    const userId = String(body.userId ?? body.user_id ?? "").trim()
    const amount = Number(body.amount)

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "amount must be a non-zero number" }, { status: 400 })
    }

    const result = await adminAdjustProfileCarrierCredit({ userId, amountUsd: amount })
    void recordAuditEvent({
      ownerUserId: userId,
      actorUserId: ctx.userId,
      actorRole: "platform_admin",
      eventType: "admin.credit_adjusted",
      entityType: "user",
      entityId: userId,
      detail: { amount_usd: amount },
    })
    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Credit adjustment failed"
    console.error("[lyncr-admin] adjust-credit:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
