// ============================================
// Earnings ledger storage (native Neon SQL — no ORM)
// ============================================
// Writes and rollups against earnings_ledger (scripts/145).
//
// Two rules hold everywhere in this module:
//
//   Writes are idempotent. Every insert goes through ON CONFLICT DO NOTHING against
//   earnings_ledger_dedupe_uidx, because Telnyx and Stripe webhooks both fire more
//   than once for the same event and a re-run of the backfill must not double-pay.
//
//   Rows are never updated. A correction is a new negative row linked by reversal_of,
//   so what a worker was told they earned stays reconstructable.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import type { EarningLine } from "@/lib/compensation/calculate"
import type { WorkerRef } from "@/lib/compensation/plan-schema"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function pgErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
}

/** True when earnings_ledger has not been created yet. */
export function isMissingLedgerTable(e: unknown): boolean {
  if (pgErrorCode(e) === "42P01") return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes("earnings_ledger") && msg.includes("does not exist")
}

/** One stored earnings row. */
export interface EarningsLedgerRow {
  id: string
  owner_user_id: string
  organization_id: string | null
  worker_role: "receptionist" | "field_tech"
  receptionist_id: string | null
  field_technician_id: string | null
  plan_id: string | null
  component_kind: string
  source_kind: string
  source_id: string | null
  amount_cents: number
  quantity: number
  earned_at: string
  pay_period_id: string | null
  reversed_by: string | null
  reversal_of: string | null
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function parseLedgerRow(row: Record<string, unknown>): EarningsLedgerRow {
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    organization_id: row.organization_id ? String(row.organization_id) : null,
    worker_role: String(row.worker_role) === "field_tech" ? "field_tech" : "receptionist",
    receptionist_id: row.receptionist_id ? String(row.receptionist_id) : null,
    field_technician_id: row.field_technician_id ? String(row.field_technician_id) : null,
    plan_id: row.plan_id ? String(row.plan_id) : null,
    component_kind: String(row.component_kind),
    source_kind: String(row.source_kind),
    source_id: row.source_id ? String(row.source_id) : null,
    amount_cents: Number(row.amount_cents ?? 0),
    quantity: Number(row.quantity ?? 0),
    earned_at: isoOrNull(row.earned_at) ?? new Date(0).toISOString(),
    pay_period_id: row.pay_period_id ? String(row.pay_period_id) : null,
    reversed_by: row.reversed_by ? String(row.reversed_by) : null,
    reversal_of: row.reversal_of ? String(row.reversal_of) : null,
  }
}

export interface RecordEarningsInput {
  ownerUserId: string
  organizationId?: string | null
  ref: WorkerRef
  workerUserId?: string | null
  /** The plan version that produced these lines. Null only for legacy-fallback pay. */
  planId?: string | null
  lines: readonly EarningLine[]
}

/**
 * Write earning lines, skipping any that are already on the ledger.
 *
 * Returns how many rows were actually inserted — a settle that returns 0 because
 * the call was already paid is a success, not a failure.
 */
export async function recordEarningLines(input: RecordEarningsInput): Promise<number> {
  if (input.lines.length === 0) return 0

  const sql = getSql()
  const receptionistId = input.ref.role === "receptionist" ? input.ref.receptionist_id : null
  const technicianId = input.ref.role === "field_tech" ? input.ref.field_technician_id : null
  let inserted = 0

  for (const line of input.lines) {
    const rows = (await sql`
      INSERT INTO earnings_ledger (
        owner_user_id, organization_id, worker_role,
        receptionist_id, field_technician_id, worker_user_id,
        plan_id, component_kind, source_kind, source_id,
        amount_cents, quantity, rate_snapshot, earned_at
      )
      VALUES (
        ${input.ownerUserId},
        ${input.organizationId ?? null},
        ${input.ref.role},
        ${receptionistId},
        ${technicianId},
        ${input.workerUserId ?? null},
        ${input.planId ?? null},
        ${line.component_kind},
        ${line.source_kind},
        ${line.source_id || null},
        ${line.amount_cents},
        ${line.quantity},
        ${JSON.stringify(
          line.provenance ? { ...line.rate_snapshot, ...line.provenance } : line.rate_snapshot
        )}::jsonb,
        ${line.earned_at}::timestamptz
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `) as Record<string, unknown>[]
    inserted += rows.length
  }

  return inserted
}

/** What a worker earned in a window, with the row count that says whether to trust it. */
export interface EarningsTotal {
  cents: number
  /**
   * Rows behind the total. Zero means the ledger has nothing to say about this
   * window — the worker earned nothing, or has not been settled yet — and callers
   * fall back to computing from the current rate rather than reporting $0.
   */
  rows: number
}

/** Total earned in a window. */
export async function getEarningsTotal(
  ref: WorkerRef,
  startIso: string,
  endIso: string
): Promise<EarningsTotal> {
  const sql = getSql()
  const receptionistId = ref.role === "receptionist" ? ref.receptionist_id : null
  const technicianId = ref.role === "field_tech" ? ref.field_technician_id : null
  try {
    const rows = (await sql`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total, COUNT(*)::int AS rows
      FROM earnings_ledger
      WHERE (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
        AND earned_at >= ${startIso}::timestamptz
        AND earned_at < ${endIso}::timestamptz
    `) as Record<string, unknown>[]
    return { cents: Number(rows[0]?.total ?? 0), rows: Number(rows[0]?.rows ?? 0) }
  } catch (e) {
    if (isMissingLedgerTable(e)) return { cents: 0, rows: 0 }
    throw e
  }
}

/** Ledger rows in a window, newest first. */
export async function listEarnings(
  ref: WorkerRef,
  startIso: string,
  endIso: string
): Promise<EarningsLedgerRow[]> {
  const sql = getSql()
  const receptionistId = ref.role === "receptionist" ? ref.receptionist_id : null
  const technicianId = ref.role === "field_tech" ? ref.field_technician_id : null
  try {
    const rows = (await sql`
      SELECT * FROM earnings_ledger
      WHERE (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
        AND earned_at >= ${startIso}::timestamptz
        AND earned_at < ${endIso}::timestamptz
      ORDER BY earned_at DESC
    `) as Record<string, unknown>[]
    return rows.map(parseLedgerRow)
  } catch (e) {
    if (isMissingLedgerTable(e)) return []
    throw e
  }
}

/** Amount earned against each source id in a window — call id → cents. */
export async function sumEarningsBySource(
  ref: WorkerRef,
  sourceKind: "CALL" | "JOB" | "SHIFT",
  startIso: string,
  endIso: string
): Promise<Map<string, number>> {
  const sql = getSql()
  const receptionistId = ref.role === "receptionist" ? ref.receptionist_id : null
  const technicianId = ref.role === "field_tech" ? ref.field_technician_id : null
  try {
    const rows = (await sql`
      SELECT source_id, COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM earnings_ledger
      WHERE (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
        AND source_kind = ${sourceKind}
        AND source_id IS NOT NULL
        AND earned_at >= ${startIso}::timestamptz
        AND earned_at < ${endIso}::timestamptz
      GROUP BY source_id
    `) as Record<string, unknown>[]
    return new Map(rows.map((r) => [String(r.source_id), Number(r.total ?? 0)]))
  } catch (e) {
    if (isMissingLedgerTable(e)) return new Map()
    throw e
  }
}

/** Per-receptionist totals for one owner in a window — receptionist id → cents. */
export async function sumOwnerEarningsByReceptionist(
  ownerUserId: string,
  startIso: string,
  endIso: string
): Promise<Map<string, number>> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT receptionist_id, COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM earnings_ledger
      WHERE owner_user_id = ${ownerUserId}
        AND receptionist_id IS NOT NULL
        AND earned_at >= ${startIso}::timestamptz
        AND earned_at < ${endIso}::timestamptz
      GROUP BY receptionist_id
    `) as Record<string, unknown>[]
    return new Map(rows.map((r) => [String(r.receptionist_id), Number(r.total ?? 0)]))
  } catch (e) {
    if (isMissingLedgerTable(e)) return new Map()
    throw e
  }
}

/**
 * Which of an owner's receptionists have ledger coverage in a window.
 *
 * The read paths use this to decide per worker whether to trust the ledger or fall
 * back to computing from the current rate. A worker with rows is settled; a worker
 * with none has either earned nothing or has not been backfilled yet, and the two
 * are indistinguishable from here — so the fallback keeps their earnings visible
 * until scripts/backfill-earnings-ledger.ts has run.
 */
export async function receptionistsWithLedgerCoverage(
  ownerUserId: string,
  startIso: string,
  endIso: string
): Promise<Set<string>> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT DISTINCT receptionist_id
      FROM earnings_ledger
      WHERE owner_user_id = ${ownerUserId}
        AND receptionist_id IS NOT NULL
        AND earned_at >= ${startIso}::timestamptz
        AND earned_at < ${endIso}::timestamptz
    `) as Record<string, unknown>[]
    return new Set(rows.map((r) => String(r.receptionist_id)))
  } catch (e) {
    if (isMissingLedgerTable(e)) return new Set()
    throw e
  }
}

/**
 * Reverse a row — a refunded job, a corrected timesheet.
 *
 * Writes the negative twin and links both, leaving the original readable. The
 * dedupe index excludes reversal rows, so a source can be reversed and re-settled.
 */
export async function reverseEarningRow(
  ledgerRowId: string,
  reversedAtIso: string
): Promise<EarningsLedgerRow | null> {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO earnings_ledger (
      owner_user_id, organization_id, worker_role,
      receptionist_id, field_technician_id, worker_user_id,
      plan_id, component_kind, source_kind, source_id,
      amount_cents, quantity, rate_snapshot, earned_at, reversal_of
    )
    SELECT
      owner_user_id, organization_id, worker_role,
      receptionist_id, field_technician_id, worker_user_id,
      plan_id, component_kind, source_kind, source_id,
      -amount_cents, quantity, rate_snapshot, ${reversedAtIso}::timestamptz, id
    FROM earnings_ledger
    WHERE id = ${ledgerRowId} AND reversed_by IS NULL AND reversal_of IS NULL
    RETURNING *
  `) as Record<string, unknown>[]

  if (!rows[0]) return null
  const reversal = parseLedgerRow(rows[0])
  await sql`UPDATE earnings_ledger SET reversed_by = ${reversal.id} WHERE id = ${ledgerRowId}`
  return reversal
}
