// GET /api/inventory/ledger — owner Usage panel: recent activity + top-consumed SKUs.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listRecentLedgerActivity, listTopConsumedSkus } from "@/lib/key-inventory-ledger"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const [activity, topConsumed] = await Promise.all([
      listRecentLedgerActivity(userId, 50),
      listTopConsumedSkus(userId, 30, 10),
    ])
    return NextResponse.json({ data: { activity, topConsumed } })
  } catch (e) {
    console.error("[inventory/ledger GET]", e)
    return NextResponse.json({ error: "Failed to load usage data" }, { status: 500 })
  }
}
