// GET /api/tech/wallet — technician earnings dashboard (balance + pending + recent txs).

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { getFieldTechnicianByPortalUserId, getUser } from "@/lib/db"
import { getTechWalletSummary } from "@/lib/tech-wallet"
import { getEarningsTotal } from "@/lib/compensation/ledger"

export const dynamic = "force-dynamic"

const EPOCH_ISO = new Date(0).toISOString()

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req.headers.get("cookie"), { capability: "view_earnings" })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — these rows are scoped to them.
  const userId = actor.actingUserId

  try {
    const [summary, tech] = await Promise.all([
      getTechWalletSummary(userId),
      getFieldTechnicianByPortalUserId(userId),
    ])

    // Owner-configured commission plan (lib/compensation/settle-job.ts) writes to
    // earnings_ledger separately from wallet_transactions above — that's cash the tech
    // physically collected on-site, this is what a pay plan says they're owed regardless
    // of who processed the charge. The wallet screen only ever showed the first one; a
    // tech with a real commission plan had no way to see what it had actually paid them.
    let commissionEarned = 0
    if (tech) {
      const totals = await getEarningsTotal(
        { role: "field_tech", field_technician_id: tech.id },
        EPOCH_ISO,
        new Date().toISOString()
      )
      commissionEarned = totals.cents / 100
    }

    return NextResponse.json({
      data: {
        availableBalance: summary.availableBalance,
        pendingClearance: summary.pendingClearance,
        commissionEarned,
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
