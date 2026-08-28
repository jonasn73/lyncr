// GET /api/tech/wallet — technician earnings dashboard (balance + pending + recent txs).

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getUser } from "@/lib/db"
import { getTechWalletSummary } from "@/lib/tech-wallet"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "view_earnings" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId

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
