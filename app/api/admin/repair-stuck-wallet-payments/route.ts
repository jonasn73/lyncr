// GET /api/admin/repair-stuck-wallet-payments — admin@lyncr.app only.
//
// Server-side twin of scripts/repair-stuck-wallet-payments.ts, for triggering against
// Production where STRIPE_SECRET_KEY and DATABASE_URL are Sensitive Vercel env vars that
// can never be pulled to a local machine. Defaults to a dry run; pass ?dryRun=false to settle.
// Delete this route once the PENDING backlog is cleared — it is a one-time repair tool.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { confirmJobPaymentIntent } from "@/lib/job-payments"

export const dynamic = "force-dynamic"

type StuckRow = {
  id: string
  user_id: string
  job_id: string | null
  amount: number
  payment_method: string
  stripe_payment_intent_id: string | null
  created_at: string
}

type RowResult = {
  id: string
  created_at: string
  amount: number
  payment_method: string
  stripe_payment_intent_id: string | null
  outcome: "would_ask_stripe" | "settled" | "failed" | "left_pending" | "skipped_no_intent" | "error"
  detail?: string
}

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get("dryRun") !== "false"
  const days = Number(searchParams.get("days") || "0") || 0
  const onlyIntent = (searchParams.get("id") || "").trim()

  const sql = neon(resolveNeonDatabaseUrl())

  const rows = (await sql`
    SELECT
      id::text, user_id::text, job_id::text, amount::float8 AS amount,
      payment_method, stripe_payment_intent_id, created_at
    FROM wallet_transactions
    WHERE status = 'PENDING'
      AND (${onlyIntent || null}::text IS NULL OR stripe_payment_intent_id = ${onlyIntent || null})
      AND (${days}::int = 0 OR created_at > now() - (${days}::int * interval '1 day'))
    ORDER BY created_at ASC
  `) as StuckRow[]

  const results: RowResult[] = []
  let settled = 0
  let failed = 0
  let leftPending = 0
  let unverifiable = 0
  let recoveredCents = 0

  for (const row of rows) {
    const base = {
      id: row.id,
      created_at: row.created_at,
      amount: row.amount,
      payment_method: row.payment_method,
      stripe_payment_intent_id: row.stripe_payment_intent_id,
    }

    if (!row.stripe_payment_intent_id) {
      results.push({ ...base, outcome: "skipped_no_intent" })
      unverifiable++
      continue
    }

    if (dryRun) {
      results.push({ ...base, outcome: "would_ask_stripe" })
      continue
    }

    try {
      const result = await confirmJobPaymentIntent(row.stripe_payment_intent_id)
      if (result.status === "succeeded" || result.status === "already_completed") {
        results.push({ ...base, outcome: "settled", detail: result.status })
        settled++
        recoveredCents += Math.round(row.amount * 100)
      } else if (result.status === "failed") {
        results.push({ ...base, outcome: "failed" })
        failed++
      } else {
        results.push({ ...base, outcome: "left_pending", detail: result.status })
        leftPending++
      }
    } catch (e) {
      results.push({ ...base, outcome: "error", detail: e instanceof Error ? e.message : String(e) })
      unverifiable++
    }
  }

  return NextResponse.json({
    data: {
      dryRun,
      total: rows.length,
      settled,
      failed,
      leftPending,
      unverifiable,
      recoveredCents,
      rows: results,
    },
  })
}
