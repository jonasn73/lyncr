// ============================================
// What a job is worth, for commission
// ============================================
// Four places in this codebase can tell you what a job was worth and they can all
// disagree: ai_leads.final_booked_total_cents (what was quoted), job_invoices
// (what was billed on site), collect_pay_links (what the customer was asked for),
// and the settled wallet_transactions row (what actually arrived). Commission needs
// one answer, and it needs to say which one it used.
//
// Preference order is money-that-moved first. A quote is a promise; a settled charge
// is a fact, and a worker's commission should follow the fact.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import type { CommissionBasis } from "@/lib/compensation/plan-schema"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

export type JobValueSource =
  | "pay_link" // collect_pay_links — has a real subtotal/tax split
  | "job_invoice" // job_invoices — has a real subtotal/tax split
  | "booked_total" // ai_leads quote — no tax breakdown
  | "none"

export interface JobCommissionBase {
  /** What the job is worth under each basis, in cents. */
  cents: Record<CommissionBasis, number>
  source: JobValueSource
  /**
   * Bases whose number is a stand-in rather than the real thing — because the data
   * to compute them exactly does not exist for this job. Recorded on the ledger row
   * so an amount can be explained later instead of quietly looking precise.
   */
  approximated: CommissionBasis[]
}

const EMPTY: JobCommissionBase = {
  cents: { COLLECTED_TOTAL: 0, SUBTOTAL_EXCL_TAX: 0, LABOR_ONLY: 0 },
  source: "none",
  approximated: [],
}

function toCents(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * Build the base set from a subtotal/tax pair.
 *
 * Tips are excluded from every basis. A tip is the customer thanking the person who
 * did the work, not revenue to take a percentage of — and where the tech keeps 100%
 * of the charge under the legacy flat rate, that behavior is preserved separately
 * rather than by quietly folding tips into a commission base.
 */
function fromSplit(subtotalCents: number, taxCents: number, source: JobValueSource): JobCommissionBase {
  const subtotal = Math.max(0, subtotalCents)
  const total = subtotal + Math.max(0, taxCents)
  return {
    cents: {
      COLLECTED_TOTAL: total,
      SUBTOTAL_EXCL_TAX: subtotal,
      // No line item in this schema says which part was labor and which was parts or
      // key stock, so labor cannot be separated. Falls back to the subtotal and says so.
      LABOR_ONLY: subtotal,
    },
    source,
    approximated: ["LABOR_ONLY"],
  }
}

/**
 * What a job is worth, for every commission basis.
 *
 * Reads the settled pay link first, then an on-site invoice, then the booked quote.
 * A job with none of those is worth nothing and pays no commission — which is the
 * right answer, not a failure.
 */
export async function resolveJobCommissionBase(jobId: string): Promise<JobCommissionBase> {
  const id = jobId.trim()
  if (!id) return EMPTY
  const sql = getSql()

  // 1. The collect link the customer was charged through — it carries the
  //    subtotal/tax split the owner chose at charge time, and tip_cents sits outside
  //    both so a tip never lands in a commission base.
  //
  //    No paid/unpaid filter here: whether the money arrived is the caller's
  //    question, and settlement only runs on a job whose payment already succeeded.
  //    job_id is TEXT on this table, so it is compared as text.
  try {
    const rows = (await sql`
      SELECT subtotal_cents, tax_cents, charge_cents
      FROM collect_pay_links
      WHERE job_id = ${id}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Record<string, unknown>[]
    if (rows[0]) {
      const subtotal = toCents(rows[0].subtotal_cents)
      const tax = toCents(rows[0].tax_cents)
      if (subtotal > 0) return fromSplit(subtotal, tax, "pay_link")
      const charge = toCents(rows[0].charge_cents)
      if (charge > 0) {
        // Charged as one number with no split recorded — the gross is all there is.
        const base = fromSplit(charge, 0, "pay_link")
        return { ...base, approximated: ["SUBTOTAL_EXCL_TAX", "LABOR_ONLY"] }
      }
    }
  } catch {
    // Pre-113 database, or the table is absent. Fall through.
  }

  // 2. An invoice raised on site.
  try {
    const rows = (await sql`
      SELECT subtotal_cents, tax_cents, total_cents
      FROM job_invoices
      WHERE lead_id = ${id}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Record<string, unknown>[]
    if (rows[0]) {
      const subtotal = toCents(rows[0].subtotal_cents)
      const tax = toCents(rows[0].tax_cents)
      if (subtotal > 0) return fromSplit(subtotal, tax, "job_invoice")
      const total = toCents(rows[0].total_cents)
      if (total > 0) {
        const base = fromSplit(total, 0, "job_invoice")
        return { ...base, approximated: ["SUBTOTAL_EXCL_TAX", "LABOR_ONLY"] }
      }
    }
  } catch {
    // Fall through.
  }

  // 3. The booked quote. No tax breakdown exists here, so every basis is the same
  //    number and two of the three are stand-ins.
  try {
    const rows = (await sql`
      SELECT final_booked_total_cents, calculated_total_cents
      FROM ai_leads
      WHERE id = ${id}
      LIMIT 1
    `) as Record<string, unknown>[]
    const quoted =
      toCents(rows[0]?.final_booked_total_cents) || toCents(rows[0]?.calculated_total_cents)
    if (quoted > 0) {
      const base = fromSplit(quoted, 0, "booked_total")
      return { ...base, approximated: ["SUBTOTAL_EXCL_TAX", "LABOR_ONLY"] }
    }
  } catch {
    // Fall through.
  }

  return EMPTY
}
