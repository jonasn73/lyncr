// GET /api/admin/finance/daily — admin@lyncr.app only. Daily platform-wide ledger rollup
// (last N days) for the Finance page chart.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { getAdminWalletDailyRollup } from "@/lib/admin-wallet-ledger"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const days = Number(req.nextUrl.searchParams.get("days") || "30") || 30
  const points = await getAdminWalletDailyRollup(days)

  return NextResponse.json({ data: { points } })
}
