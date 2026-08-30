// Platform-wide billing ledger for admin Finance — Lyncr's prepaid phone-credit book: every
// credit pack purchased and every dollar burned (calls, SMS, number purchases), per business.
// This is what "Credit packs sold" and the wallet-burn portion of "Phone cost" are actually
// made of — a real running balance, not a formula.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type AdminBillingLedgerRow = {
  id: string
  ownerUserId: string | null
  businessName: string
  deltaCents: number
  deltaLabel: string
  balanceAfterCents: number
  balanceAfterLabel: string
  reason: string
  reference: string | null
  createdAt: string
}

export type AdminBillingLedgerFilters = {
  ownerUserId?: string | null
  reason?: string | null
  gteIso?: string | null
  ltIso?: string | null
  limit?: number
  offset?: number
}

export type AdminBillingLedgerPage = {
  rows: AdminBillingLedgerRow[]
  totalCount: number
  limit: number
  offset: number
}

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round(cents) / 100
  )
}

function mapRow(row: Record<string, unknown>): AdminBillingLedgerRow {
  const deltaCents = Number(row.delta_cents ?? 0) || 0
  const balanceAfterCents = Number(row.balance_after_cents ?? 0) || 0
  const created =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? new Date().toISOString())
  return {
    id: String(row.id),
    ownerUserId: row.user_id != null ? String(row.user_id) : null,
    businessName: String(row.business_name ?? "Unnamed business"),
    deltaCents,
    deltaLabel: formatUsdFromCents(deltaCents),
    balanceAfterCents,
    balanceAfterLabel: formatUsdFromCents(balanceAfterCents),
    reason: String(row.reason ?? ""),
    reference: row.reference != null ? String(row.reference).trim() || null : null,
    createdAt: created,
  }
}

export async function listAdminBillingLedger(
  filters: AdminBillingLedgerFilters
): Promise<AdminBillingLedgerPage> {
  const sql = neon(resolveNeonDatabaseUrl())
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50))
  const offset = Math.max(0, filters.offset ?? 0)
  const ownerUserId = filters.ownerUserId?.trim() || null
  const reason = filters.reason?.trim() || null
  const gteIso = filters.gteIso ?? null
  const ltIso = filters.ltIso ?? null

  try {
    const rows = (await sql`
      SELECT
        bl.id::text, bl.user_id::text, bl.delta_cents, bl.balance_after_cents, bl.reason,
        bl.reference, bl.created_at,
        coalesce(nullif(trim(u.business_name), ''), 'Unnamed business') AS business_name
      FROM billing_ledger bl
      LEFT JOIN users u ON u.id = bl.user_id
      WHERE (${ownerUserId}::text IS NULL OR bl.user_id::text = ${ownerUserId})
        AND (${reason}::text IS NULL OR bl.reason = ${reason})
        AND (${gteIso}::timestamptz IS NULL OR bl.created_at >= ${gteIso}::timestamptz)
        AND (${ltIso}::timestamptz IS NULL OR bl.created_at < ${ltIso}::timestamptz)
      ORDER BY bl.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `) as Record<string, unknown>[]

    const countRows = (await sql`
      SELECT COUNT(*)::int AS n
      FROM billing_ledger bl
      WHERE (${ownerUserId}::text IS NULL OR bl.user_id::text = ${ownerUserId})
        AND (${reason}::text IS NULL OR bl.reason = ${reason})
        AND (${gteIso}::timestamptz IS NULL OR bl.created_at >= ${gteIso}::timestamptz)
        AND (${ltIso}::timestamptz IS NULL OR bl.created_at < ${ltIso}::timestamptz)
    `) as { n?: number }[]

    return {
      rows: rows.map(mapRow),
      totalCount: Number(countRows[0]?.n ?? 0) || 0,
      limit,
      offset,
    }
  } catch (e) {
    console.warn("[admin-billing-ledger] list failed:", e)
    return { rows: [], totalCount: 0, limit, offset }
  }
}
