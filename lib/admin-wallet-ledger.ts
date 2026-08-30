// Platform-wide wallet transaction ledger for admin Finance — every charge, fee, reversal,
// and payout across every business, filterable and paginated. Read-only; the source of truth
// for "what actually happened to this dollar" when auditing a business's numbers.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type AdminLedgerEntryType = "CHARGE" | "REVERSAL" | "PAYOUT" | "FEE"
export type AdminLedgerStatus = "PENDING" | "COMPLETED" | "FAILED"

export type AdminLedgerRow = {
  id: string
  ownerUserId: string | null
  businessName: string
  amountCents: number
  amountLabel: string
  status: AdminLedgerStatus
  entryType: AdminLedgerEntryType
  paymentMethod: string
  stripePaymentIntentId: string | null
  customerName: string | null
  customerPhone: string | null
  reversalReason: string | null
  createdAt: string
}

export type AdminLedgerFilters = {
  ownerUserId?: string | null
  entryType?: AdminLedgerEntryType | null
  status?: AdminLedgerStatus | null
  gteIso?: string | null
  ltIso?: string | null
  /** Matches customer_name or business_name (case-insensitive substring). */
  search?: string | null
  limit?: number
  offset?: number
}

export type AdminLedgerPage = {
  rows: AdminLedgerRow[]
  totalCount: number
  limit: number
  offset: number
}

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round(cents) / 100
  )
}

function mapRow(row: Record<string, unknown>): AdminLedgerRow {
  const amountUsd = Number(row.amount ?? 0) || 0
  const amountCents = Math.round(amountUsd * 100)
  const created =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? new Date().toISOString())
  const statusRaw = String(row.status ?? "PENDING").toUpperCase()
  const entryTypeRaw = String(row.entry_type ?? "CHARGE").toUpperCase()
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id != null ? String(row.owner_user_id) : null,
    businessName: String(row.business_name ?? "Unnamed business"),
    amountCents,
    amountLabel: formatUsdFromCents(amountCents),
    status: (statusRaw === "COMPLETED" || statusRaw === "FAILED" ? statusRaw : "PENDING") as AdminLedgerStatus,
    entryType: (["REVERSAL", "PAYOUT", "FEE"].includes(entryTypeRaw) ? entryTypeRaw : "CHARGE") as AdminLedgerEntryType,
    paymentMethod: String(row.payment_method ?? ""),
    stripePaymentIntentId:
      row.stripe_payment_intent_id != null ? String(row.stripe_payment_intent_id).trim() || null : null,
    customerName:
      row.customer_name != null && String(row.customer_name).trim()
        ? String(row.customer_name).trim()
        : null,
    customerPhone:
      row.customer_phone != null && String(row.customer_phone).trim()
        ? String(row.customer_phone).trim()
        : null,
    reversalReason: row.reversal_reason != null ? String(row.reversal_reason) : null,
    createdAt: created,
  }
}

export async function listAdminWalletLedger(filters: AdminLedgerFilters): Promise<AdminLedgerPage> {
  const sql = neon(resolveNeonDatabaseUrl())
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50))
  const offset = Math.max(0, filters.offset ?? 0)
  const ownerUserId = filters.ownerUserId?.trim() || null
  const entryType = filters.entryType ?? null
  const status = filters.status ?? null
  const gteIso = filters.gteIso ?? null
  const ltIso = filters.ltIso ?? null
  const search = filters.search?.trim() || null
  const searchLike = search ? `%${search}%` : null

  try {
    const rows = (await sql`
      SELECT
        wt.id::text, wt.owner_user_id::text, wt.amount::float8, wt.status, wt.entry_type,
        wt.payment_method, wt.stripe_payment_intent_id, wt.customer_name, wt.customer_phone,
        wt.reversal_reason, wt.created_at,
        coalesce(nullif(trim(u.business_name), ''), 'Unnamed business') AS business_name
      FROM wallet_transactions wt
      LEFT JOIN users u ON u.id = wt.owner_user_id
      WHERE (${ownerUserId}::text IS NULL OR wt.owner_user_id::text = ${ownerUserId})
        AND (${entryType}::text IS NULL OR wt.entry_type = ${entryType})
        AND (${status}::text IS NULL OR wt.status = ${status})
        AND (${gteIso}::timestamptz IS NULL OR wt.created_at >= ${gteIso}::timestamptz)
        AND (${ltIso}::timestamptz IS NULL OR wt.created_at < ${ltIso}::timestamptz)
        AND (
          ${searchLike}::text IS NULL
          OR wt.customer_name ILIKE ${searchLike}
          OR u.business_name ILIKE ${searchLike}
        )
      ORDER BY wt.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `) as Record<string, unknown>[]

    const countRows = (await sql`
      SELECT COUNT(*)::int AS n
      FROM wallet_transactions wt
      LEFT JOIN users u ON u.id = wt.owner_user_id
      WHERE (${ownerUserId}::text IS NULL OR wt.owner_user_id::text = ${ownerUserId})
        AND (${entryType}::text IS NULL OR wt.entry_type = ${entryType})
        AND (${status}::text IS NULL OR wt.status = ${status})
        AND (${gteIso}::timestamptz IS NULL OR wt.created_at >= ${gteIso}::timestamptz)
        AND (${ltIso}::timestamptz IS NULL OR wt.created_at < ${ltIso}::timestamptz)
        AND (
          ${searchLike}::text IS NULL
          OR wt.customer_name ILIKE ${searchLike}
          OR u.business_name ILIKE ${searchLike}
        )
    `) as { n?: number }[]

    return {
      rows: rows.map(mapRow),
      totalCount: Number(countRows[0]?.n ?? 0) || 0,
      limit,
      offset,
    }
  } catch (e) {
    console.warn("[admin-wallet-ledger] list failed:", e)
    return { rows: [], totalCount: 0, limit, offset }
  }
}
