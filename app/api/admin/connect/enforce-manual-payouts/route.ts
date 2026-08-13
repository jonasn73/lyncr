// POST /api/admin/connect/enforce-manual-payouts
// Turn off automatic Stripe bank payouts for one or all Connect accounts (admin only).

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { ensureManualConnectPayoutSchedule } from "@/lib/stripe-connect"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

async function listConnectAccountIdsFromDb(): Promise<string[]> {
  const sql = neon(resolveNeonDatabaseUrl())
  const rows = await sql`
    SELECT DISTINCT stripe_connect_account_id AS id
    FROM users
    WHERE stripe_connect_account_id IS NOT NULL
      AND btrim(stripe_connect_account_id) <> ''
  `
  return rows
    .map((r) => String((r as { id?: string }).id || "").trim())
    .filter((id) => id.startsWith("acct_"))
}

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => ({}))) as {
    /** Optional single Connect account id (e.g. Key Squad acct_…). */
    accountId?: string
  }

  const one = String(body.accountId || "").trim()
  let accountIds: string[]
  if (one) {
    accountIds = [one]
  } else {
    try {
      accountIds = await listConnectAccountIdsFromDb()
    } catch (e) {
      console.error("[admin/connect/enforce-manual-payouts] list:", e)
      return NextResponse.json({ error: "Could not list Connect accounts." }, { status: 500 })
    }
  }

  if (accountIds.length === 0) {
    return NextResponse.json({ error: "No Connect accounts found." }, { status: 404 })
  }

  const results: { accountId: string; interval: string; updated: boolean }[] = []
  for (const accountId of accountIds) {
    const r = await ensureManualConnectPayoutSchedule(accountId)
    results.push({ accountId, interval: r.interval, updated: r.updated })
  }

  return NextResponse.json({
    data: {
      count: results.length,
      updatedCount: results.filter((r) => r.updated).length,
      results,
      note: "Payout schedule is manual — money stays in wallet until Send to bank.",
    },
  })
}
