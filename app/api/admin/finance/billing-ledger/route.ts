// GET /api/admin/finance/billing-ledger — admin@lyncr.app only. Real billing_ledger rows:
// every prepaid credit pack purchased and every dollar burned, filterable and paginated.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listAdminBillingLedger } from "@/lib/admin-billing-ledger"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = req.nextUrl
  const ownerUserId = searchParams.get("ownerUserId")
  const reason = searchParams.get("reason")
  const gteIso = searchParams.get("gte")
  const ltIso = searchParams.get("lt")
  const limit = Number(searchParams.get("limit") || "50") || 50
  const offset = Number(searchParams.get("offset") || "0") || 0

  const page = await listAdminBillingLedger({ ownerUserId, reason, gteIso, ltIso, limit, offset })

  return NextResponse.json({ data: page })
}
