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
    // Job payments (via ai_leads owner) + walk-up / ad-hoc charges on the owner's wallet.
    const rows = await sql`
      SELECT
        COALESCE(SUM(wt.amount) FILTER (WHERE wt.created_at >= ${dayStart}::timestamptz), 0)::float8 AS today_usd,
        COALESCE(SUM(wt.amount) FILTER (WHERE wt.created_at >= ${monthStart}::timestamptz), 0)::float8 AS month_usd,
        COALESCE(COUNT(*) FILTER (WHERE wt.created_at >= ${dayStart}::timestamptz), 0)::int AS today_count
      FROM wallet_transactions wt
      LEFT JOIN ai_leads al ON al.id = wt.job_id
      WHERE wt.status = 'COMPLETED'
        AND wt.amount > 0
        AND (
          al.user_id = ${uid}
          OR (wt.job_id IS NULL AND wt.user_id = ${uid})
        )
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

export type OwnerCollectedTransaction = {
  id: string
  /** USD dollars (wallet_transactions.amount). */
  amount: number
  status: "PENDING" | "COMPLETED" | "FAILED"
  paymentMethod: "TAP_TO_PAY" | "MANUAL_CARD" | "CASH"
  createdAt: string
  jobId: string | null
  customerName: string | null
  customerPhone: string | null
  jobLabel: string | null
  stripePaymentIntentId: string | null
  tipCents: number | null
  hasSignature: boolean
}

/**
 * Recent wallet ledger rows for this business (job payments + walk-up charges).
 * Includes pending/failed so owners can look up cards that did not settle.
 */
export async function listOwnerCollectedTransactions(
  ownerUserId: string,
  limit = 50
): Promise<OwnerCollectedTransaction[]> {
  const uid = ownerUserId.trim()
  if (!uid) return []

  const sql = neon(resolveNeonDatabaseUrl())
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))

  try {
    const rows = await sql`
      SELECT
        wt.id::text AS id,
        wt.amount::float8 AS amount,
        wt.status,
        wt.payment_method,
        wt.created_at,
        wt.job_id::text AS job_id,
        wt.stripe_payment_intent_id,
        al.caller_e164,
        COALESCE(
          NULLIF(TRIM(al.collected->>'customer_name'), ''),
          NULLIF(TRIM(al.collected->>'name'), ''),
          NULLIF(TRIM(al.collected->>'caller_name'), '')
        ) AS customer_name,
        COALESCE(
          NULLIF(TRIM(al.collected->>'vehicle_year'), ''),
          NULLIF(TRIM(al.vehicle_year::text), '')
        ) AS vehicle_year,
        COALESCE(
          NULLIF(TRIM(al.collected->>'vehicle_make'), ''),
          NULLIF(TRIM(al.vehicle_make), '')
        ) AS vehicle_make,
        COALESCE(
          NULLIF(TRIM(al.collected->>'vehicle_model'), ''),
          NULLIF(TRIM(al.vehicle_model), '')
        ) AS vehicle_model,
        COALESCE(
          NULLIF(TRIM(al.collected->>'job_type'), ''),
          NULLIF(TRIM(al.job_type), '')
        ) AS job_type,
        ps.tip_cents,
        CASE WHEN ps.signature_png IS NOT NULL AND ps.signature_png <> '' THEN true ELSE false END AS has_signature
      FROM wallet_transactions wt
      LEFT JOIN ai_leads al ON al.id = wt.job_id
      LEFT JOIN payment_slips ps ON ps.stripe_payment_intent_id = wt.stripe_payment_intent_id
      WHERE
        al.user_id = ${uid}
        OR (wt.job_id IS NULL AND wt.user_id = ${uid})
      ORDER BY wt.created_at DESC
      LIMIT ${safeLimit}
    `

    return (rows as Record<string, unknown>[]).map(mapOwnerCollectedRow)
  } catch (e) {
    // payment_slips / column differences — retry a leaner query.
    const msg = e instanceof Error ? e.message : String(e)
    if (/payment_slips|vehicle_year|vehicle_make|job_type|column/i.test(msg) || isMissingWalletSchemaError(e)) {
      try {
        const rows = await sql`
          SELECT
            wt.id::text AS id,
            wt.amount::float8 AS amount,
            wt.status,
            wt.payment_method,
            wt.created_at,
            wt.job_id::text AS job_id,
            wt.stripe_payment_intent_id,
            al.caller_e164,
            COALESCE(
              NULLIF(TRIM(al.collected->>'customer_name'), ''),
              NULLIF(TRIM(al.collected->>'name'), ''),
              NULLIF(TRIM(al.collected->>'caller_name'), '')
            ) AS customer_name,
            NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
            NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
            NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
            NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type
          FROM wallet_transactions wt
          LEFT JOIN ai_leads al ON al.id = wt.job_id
          WHERE
            al.user_id = ${uid}
            OR (wt.job_id IS NULL AND wt.user_id = ${uid})
          ORDER BY wt.created_at DESC
          LIMIT ${safeLimit}
        `
        return (rows as Record<string, unknown>[]).map(mapOwnerCollectedRow)
      } catch (e2) {
        if (isMissingWalletSchemaError(e2)) return []
        console.warn("[owner-collected] list fallback failed:", e2)
        return []
      }
    }
    console.warn("[owner-collected] list failed:", e)
    return []
  }
}

function mapOwnerCollectedRow(row: Record<string, unknown>): OwnerCollectedTransaction {
  const statusRaw = String(row.status || "PENDING").toUpperCase()
  const status: OwnerCollectedTransaction["status"] =
    statusRaw === "COMPLETED" || statusRaw === "FAILED" ? statusRaw : "PENDING"
  const methodRaw = String(row.payment_method || "MANUAL_CARD").toUpperCase()
  const paymentMethod: OwnerCollectedTransaction["paymentMethod"] =
    methodRaw === "TAP_TO_PAY" || methodRaw === "CASH" ? methodRaw : "MANUAL_CARD"
  const year = row.vehicle_year != null ? String(row.vehicle_year) : ""
  const make = row.vehicle_make != null ? String(row.vehicle_make) : ""
  const model = row.vehicle_model != null ? String(row.vehicle_model) : ""
  const jobType = row.job_type != null ? String(row.job_type).trim() : ""
  const vehicle = [year, make, model].filter(Boolean).join(" ").trim()
  return {
    id: String(row.id),
    amount: Number(row.amount ?? 0) || 0,
    status,
    paymentMethod,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
    jobId: row.job_id != null ? String(row.job_id) : null,
    customerName:
      row.customer_name != null && String(row.customer_name).trim()
        ? String(row.customer_name).trim()
        : null,
    customerPhone:
      row.caller_e164 != null && String(row.caller_e164).trim()
        ? String(row.caller_e164).trim()
        : null,
    jobLabel: vehicle || jobType || null,
    stripePaymentIntentId:
      row.stripe_payment_intent_id != null ? String(row.stripe_payment_intent_id) : null,
    tipCents:
      row.tip_cents != null && Number.isFinite(Number(row.tip_cents))
        ? Math.round(Number(row.tip_cents))
        : null,
    hasSignature: row.has_signature === true,
  }
}
