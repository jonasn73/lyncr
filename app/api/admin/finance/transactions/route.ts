// GET /api/admin/finance/transactions — admin@lyncr.app only. Platform-wide wallet ledger,
// filterable by business / type / status / date range, paginated.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  listAdminWalletLedger,
  type AdminLedgerEntryType,
  type AdminLedgerStatus,
} from "@/lib/admin-wallet-ledger"

export const dynamic = "force-dynamic"

const ENTRY_TYPES: AdminLedgerEntryType[] = ["CHARGE", "REVERSAL", "PAYOUT", "FEE"]
const STATUSES: AdminLedgerStatus[] = ["PENDING", "COMPLETED", "FAILED"]

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = req.nextUrl
  const ownerUserId = searchParams.get("ownerUserId")
  const entryTypeRaw = (searchParams.get("entryType") || "").toUpperCase()
  const statusRaw = (searchParams.get("status") || "").toUpperCase()
  const gteIso = searchParams.get("gte")
  const ltIso = searchParams.get("lt")
  const search = searchParams.get("q")
  const limit = Number(searchParams.get("limit") || "50") || 50
  const offset = Number(searchParams.get("offset") || "0") || 0

  const page = await listAdminWalletLedger({
    ownerUserId,
    entryType: ENTRY_TYPES.includes(entryTypeRaw as AdminLedgerEntryType)
      ? (entryTypeRaw as AdminLedgerEntryType)
      : null,
    status: STATUSES.includes(statusRaw as AdminLedgerStatus) ? (statusRaw as AdminLedgerStatus) : null,
    gteIso,
    ltIso,
    search,
    limit,
    offset,
  })

  return NextResponse.json({ data: page })
}
