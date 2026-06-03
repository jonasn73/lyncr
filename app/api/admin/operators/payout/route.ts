// POST /api/admin/operators/payout — "Mark Paid": logs a balance-reset transaction in the
// payout ledger for one receptionist (admin@lyncr.app only). The paid amount is computed
// server-side from the current accrued balance, never trusted from the client.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getOperatorPayoutSnapshot, recordOperatorPayout } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => ({}))) as { receptionistId?: string; note?: string }
  const receptionistId = String(body.receptionistId || "").trim()
  if (!receptionistId) return NextResponse.json({ error: "receptionistId is required" }, { status: 400 })

  try {
    const snapshot = await getOperatorPayoutSnapshot(receptionistId)
    if (!snapshot) return NextResponse.json({ error: "Operator not found" }, { status: 404 })
    if (snapshot.accrued_usd <= 0) {
      return NextResponse.json({ error: "Nothing to pay out — balance is $0.00" }, { status: 400 })
    }

    await recordOperatorPayout({
      receptionistId,
      amountUsd: snapshot.accrued_usd,
      minutesPaid: snapshot.total_minutes,
      note: body.note?.trim() || null,
      adminUserId: ctx.userId,
    })

    return NextResponse.json({
      data: { receptionistId, paid_usd: snapshot.accrued_usd, minutes_paid: snapshot.total_minutes },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Payout failed"
    console.error("[admin/operators/payout] POST:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
