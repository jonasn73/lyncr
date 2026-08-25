// ============================================
// The commission rate a job's tech is actually on
// ============================================
// Bridges the payment path to compensation plans. Kept separate from settle-job so
// the payment path pulls in a rate lookup and nothing else — a customer's card must
// not be waiting on the whole earnings module.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getLivePlan } from "@/lib/compensation/plans"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

/**
 * The commission rate in basis points for the tech this job is dispatched to.
 *
 * Returns null — meaning "fall back to the global rate" — in every case where the
 * answer is not certain: no tech assigned, no plan, or a plan with no commission
 * component. A tech paid per completed job rather than a percentage has no rate
 * here, and their flat amount comes from the earnings ledger instead.
 */
export async function resolveTechCommissionRateBps(jobId: string): Promise<number | null> {
  const id = jobId.trim()
  if (!id) return null

  const sql = getSql()
  let technicianId: string | null = null
  try {
    const rows = (await sql`
      SELECT ft.id
      FROM ai_leads l
      JOIN field_technicians ft
        ON ft.portal_user_id = l.assigned_tech_id AND ft.user_id = l.user_id
      WHERE l.id = ${id}
      LIMIT 1
    `) as Record<string, unknown>[]
    technicianId = rows[0]?.id ? String(rows[0].id) : null
  } catch {
    return null
  }
  if (!technicianId) return null

  const plan = await getLivePlan({ role: "field_tech", field_technician_id: technicianId })
  if (!plan) return null

  const commission = plan.components.find((c) => c.kind === "COMMISSION")
  return commission && commission.kind === "COMMISSION" ? commission.rate_bps : null
}
