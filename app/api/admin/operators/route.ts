// GET /api/admin/operators — receptionist payout ledger metrics (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listOperatorPayouts } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const operators = await listOperatorPayouts()
    return NextResponse.json({ data: { operators } })
  } catch (e) {
    console.error("[admin/operators] GET:", e)
    return NextResponse.json({ error: "Could not load operators" }, { status: 500 })
  }
}
