// GET /api/tech/wallet — technician earnings dashboard (balance + pending + recent txs).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser } from "@/lib/db"
import { getTechWalletSummary } from "@/lib/tech-wallet"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const summary = await getTechWalletSummary(userId)
    return NextResponse.json({
      data: {
        availableBalance: summary.availableBalance,
        pendingClearance: summary.pendingClearance,
        recentTransactions: summary.recentTransactions.map((tx) => ({
          id: tx.id,
          jobId: tx.jobId,
          amount: tx.amount,
          status: tx.status,
          paymentMethod: tx.paymentMethod,
          stripePaymentIntentId: tx.stripePaymentIntentId,
          createdAt: tx.createdAt,
        })),
      },
    })
  } catch (e) {
    console.error("[tech/wallet]", e)
    return NextResponse.json({ error: "Could not load wallet" }, { status: 500 })
  }
}
