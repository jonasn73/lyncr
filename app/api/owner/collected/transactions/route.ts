// GET /api/owner/collected/transactions — past card / Tap to Pay / cash charges for Money + Collect History.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listOwnerCollectedTransactionsReconciled } from "@/lib/owner-collected-reconcile"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const lim = Number(req.nextUrl.searchParams.get("limit") || "100")
  const safeLimit = Number.isFinite(lim) ? lim : 100
  const q = (req.nextUrl.searchParams.get("q") || "").trim()

  try {
    const transactions = await listOwnerCollectedTransactionsReconciled(userId, {
      limit: safeLimit,
      q: q || undefined,
    })
    return NextResponse.json({ data: { transactions } })
  } catch (e) {
    console.error("[GET /api/owner/collected/transactions]", e)
    return NextResponse.json({ error: "Could not load payment history" }, { status: 500 })
  }
}
