// Owner "amount collected" — completed job payments for the business (today / month).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { isMissingWalletSchemaError } from "@/lib/tech-wallet"

export type OwnerCollectedSummary = {
  /** Customer / wallet-settled dollars collected today (local calendar day). */
  todayCents: number
  /** Settled dollars collected since the start of the current month. */
  monthCents: number
  /** Number of completed payment rows today. */
  todayCount: number
}

function startOfLocalDayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfLocalMonthIso(): string {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * Sum completed wallet ledger rows on jobs owned by this business.
 * When TECH_JOB_COMMISSION_RATE is 1 (default), wallet amount ≈ customer charge.
 */
export async function getOwnerCollectedSummary(
  ownerUserId: string
): Promise<OwnerCollectedSummary> {
  const empty: OwnerCollectedSummary = { todayCents: 0, monthCents: 0, todayCount: 0 }
  const uid = ownerUserId.trim()
  if (!uid) return empty

  const sql = neon(resolveNeonDatabaseUrl())
  const dayStart = startOfLocalDayIso()
  const monthStart = startOfLocalMonthIso()

  try {
    const rows = await sql`
      SELECT
        COALESCE(SUM(wt.amount) FILTER (WHERE wt.created_at >= ${dayStart}::timestamptz), 0)::float8 AS today_usd,
        COALESCE(SUM(wt.amount) FILTER (WHERE wt.created_at >= ${monthStart}::timestamptz), 0)::float8 AS month_usd,
        COALESCE(COUNT(*) FILTER (WHERE wt.created_at >= ${dayStart}::timestamptz), 0)::int AS today_count
      FROM wallet_transactions wt
      INNER JOIN ai_leads al ON al.id = wt.job_id
      WHERE al.user_id = ${uid}
        AND wt.status = 'COMPLETED'
        AND wt.amount > 0
    `
    const row = rows[0] as
      | { today_usd?: number; month_usd?: number; today_count?: number }
      | undefined
    const todayUsd = Number(row?.today_usd ?? 0) || 0
    const monthUsd = Number(row?.month_usd ?? 0) || 0
    return {
      todayCents: Math.round(todayUsd * 100),
      monthCents: Math.round(monthUsd * 100),
      todayCount: Number(row?.today_count ?? 0) || 0,
    }
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return empty
    console.warn("[owner-collected] summary failed:", e)
    return empty
  }
}

export function formatCollectedDollars(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}
