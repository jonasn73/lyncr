// GET /api/admin/infra-cost — this month's Vercel + Neon spend vs budget, plus the
// Telnyx prepaid wallet balance vs a low-balance floor (admin only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  fetchNeonConsumption,
  fetchTelnyxBalance,
  fetchVercelBillingCharges,
  resolveNeonMonthlyBudgetCents,
  resolveVercelMonthlyBudgetCents,
  type InfraCostByCategory,
} from "@/lib/admin-infra-cost"

function currentMonthRangeUtc(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { from: from.toISOString(), to: to.toISOString() }
}

function sumCents(rows: InfraCostByCategory[]): number {
  return rows.reduce((sum, r) => sum + r.costCents, 0)
}

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const range = currentMonthRangeUtc()
    const [vercel, neon, telnyx] = await Promise.all([
      fetchVercelBillingCharges(range),
      fetchNeonConsumption(range),
      fetchTelnyxBalance(),
    ])
    const vercelBudgetCents = resolveVercelMonthlyBudgetCents()
    const neonBudgetCents = resolveNeonMonthlyBudgetCents()
    const vercelSpendCents = sumCents(vercel.categories)
    const neonSpendCents = sumCents(neon.categories)

    return NextResponse.json({
      data: {
        range,
        vercel: {
          categories: vercel.categories,
          spend_cents: vercelSpendCents,
          budget_cents: vercelBudgetCents,
          percent_of_budget: vercelBudgetCents > 0 ? Math.round((vercelSpendCents / vercelBudgetCents) * 100) : 0,
          configured: Boolean(process.env.VERCEL_API_TOKEN?.trim()),
          // configured-but-failed is distinct from genuine $0 spend — see lib/admin-infra-cost.ts.
          data_available: vercel.ok,
          error: vercel.error ?? null,
        },
        neon: {
          categories: neon.categories,
          spend_cents: neonSpendCents,
          budget_cents: neonBudgetCents,
          percent_of_budget: neonBudgetCents > 0 ? Math.round((neonSpendCents / neonBudgetCents) * 100) : 0,
          configured: Boolean(process.env.NEON_API_KEY?.trim()),
          data_available: neon.ok,
          error: neon.error ?? null,
        },
        telnyx: {
          balance_cents: telnyx.balanceCents,
          floor_cents: telnyx.floorCents,
          low_balance: telnyx.ok && telnyx.balanceCents <= telnyx.floorCents,
          data_available: telnyx.ok,
          error: telnyx.error ?? null,
        },
      },
    })
  } catch (e) {
    console.error("[lyncr-admin] infra-cost:", e)
    return NextResponse.json({ error: "Failed to load infra cost" }, { status: 500 })
  }
}
