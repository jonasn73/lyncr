// ============================================
// Job settlement — turn a completed job into ledger rows
// ============================================
// Runs when a job's payment succeeds. Pays whoever has a plan with a job-shaped
// component: the tech it was dispatched to, and the receptionist who booked it.
//
// Idempotent like call settlement — the ledger's dedupe index means a Stripe webhook
// that fires twice writes the row once.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { calculateEarnings, type JobPayEvent } from "@/lib/compensation/calculate"
import { resolveJobCommissionBase } from "@/lib/compensation/job-value"
import { recordEarningLines, reverseEarningRow, listEarnings } from "@/lib/compensation/ledger"
import { getPlanInForceAt } from "@/lib/compensation/plans"
import type { WorkerRef } from "@/lib/compensation/plan-schema"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

/** The job, with both people who might be owed something for it. */
interface JobSettlementRow {
  job_id: string
  owner_user_id: string
  organization_id: string | null
  job_status: string | null
  /** Roster row of the dispatched tech, resolved from assigned_tech_id. */
  field_technician_id: string | null
  tech_user_id: string | null
  booked_by_receptionist_id: string | null
  receptionist_user_id: string | null
  attribution_inferred: boolean
}

function isMissingColumn(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
  return code === "42703" || code === "42P01"
}

/**
 * Load the job and both potential earners.
 *
 * assigned_tech_id is a users.id, but plans key on the field_technicians roster row,
 * so it is joined through. Booking attribution columns come from scripts/149 and are
 * tolerated as absent so this keeps working before that migration runs.
 */
async function loadJobRow(jobId: string): Promise<JobSettlementRow | null> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT
        l.id AS job_id, l.user_id AS owner_user_id, l.organization_id, l.job_status,
        ft.id AS field_technician_id, ft.portal_user_id AS tech_user_id,
        l.booked_by_receptionist_id,
        r.portal_user_id AS receptionist_user_id,
        COALESCE(l.booking_attribution_inferred, false) AS attribution_inferred
      FROM ai_leads l
      LEFT JOIN field_technicians ft
        ON ft.portal_user_id = l.assigned_tech_id AND ft.user_id = l.user_id
      LEFT JOIN receptionists r ON r.id = l.booked_by_receptionist_id
      WHERE l.id = ${jobId}
      LIMIT 1
    `) as Record<string, unknown>[]
    if (!rows[0]) return null
    const row = rows[0]
    return {
      job_id: String(row.job_id),
      owner_user_id: String(row.owner_user_id),
      organization_id: row.organization_id ? String(row.organization_id) : null,
      job_status: row.job_status ? String(row.job_status) : null,
      field_technician_id: row.field_technician_id ? String(row.field_technician_id) : null,
      tech_user_id: row.tech_user_id ? String(row.tech_user_id) : null,
      booked_by_receptionist_id: row.booked_by_receptionist_id
        ? String(row.booked_by_receptionist_id)
        : null,
      receptionist_user_id: row.receptionist_user_id ? String(row.receptionist_user_id) : null,
      attribution_inferred: row.attribution_inferred === true,
    }
  } catch (e) {
    if (!isMissingColumn(e)) throw e
    // Pre-149: no attribution columns, so only the tech can be paid.
    const rows = (await sql`
      SELECT
        l.id AS job_id, l.user_id AS owner_user_id, l.organization_id, l.job_status,
        ft.id AS field_technician_id, ft.portal_user_id AS tech_user_id
      FROM ai_leads l
      LEFT JOIN field_technicians ft
        ON ft.portal_user_id = l.assigned_tech_id AND ft.user_id = l.user_id
      WHERE l.id = ${jobId}
      LIMIT 1
    `) as Record<string, unknown>[]
    if (!rows[0]) return null
    const row = rows[0]
    return {
      job_id: String(row.job_id),
      owner_user_id: String(row.owner_user_id),
      organization_id: row.organization_id ? String(row.organization_id) : null,
      job_status: row.job_status ? String(row.job_status) : null,
      field_technician_id: row.field_technician_id ? String(row.field_technician_id) : null,
      tech_user_id: row.tech_user_id ? String(row.tech_user_id) : null,
      booked_by_receptionist_id: null,
      receptionist_user_id: null,
      attribution_inferred: false,
    }
  }
}

interface JobSettlementResult {
  inserted: number
  /** Workers who had a plan with something to pay on this job. */
  paid: ("field_tech" | "receptionist")[]
  skipped?: "job_not_found" | "worth_nothing"
}

/**
 * Settle a completed, paid job.
 *
 * `paid` is passed by the caller rather than read from the row, because the job
 * status and the payment settle in the same breath and reading it back races.
 */
export async function settleJobEarnings(params: {
  jobId: string
  paid: boolean
  occurredAt?: string
}): Promise<JobSettlementResult> {
  const row = await loadJobRow(params.jobId)
  if (!row) return { inserted: 0, paid: [], skipped: "job_not_found" }

  const value = await resolveJobCommissionBase(row.job_id)
  const occurredAt = params.occurredAt ?? new Date().toISOString()

  const event: JobPayEvent = {
    kind: "JOB",
    id: row.job_id,
    occurred_at: occurredAt,
    // A job that reached settlement was booked — it exists as a lead with a price.
    booked: true,
    completed: String(row.job_status ?? "").toLowerCase() === "completed",
    paid: params.paid,
    base_cents: value.cents,
  }

  const earners: { ref: WorkerRef; workerUserId: string | null; kind: "field_tech" | "receptionist" }[] =
    []
  if (row.field_technician_id) {
    earners.push({
      ref: { role: "field_tech", field_technician_id: row.field_technician_id },
      workerUserId: row.tech_user_id,
      kind: "field_tech",
    })
  }
  // Inferred attribution is a guess about who booked the job. Paying a commission on
  // it would move real money on a maybe, so those rows are left for an owner to
  // confirm rather than settled automatically.
  if (row.booked_by_receptionist_id && !row.attribution_inferred) {
    earners.push({
      ref: { role: "receptionist", receptionist_id: row.booked_by_receptionist_id },
      workerUserId: row.receptionist_user_id,
      kind: "receptionist",
    })
  }

  let inserted = 0
  const paid: ("field_tech" | "receptionist")[] = []

  for (const earner of earners) {
    const plan = await getPlanInForceAt(earner.ref, occurredAt)
    if (!plan || plan.components.length === 0) continue

    const lines = calculateEarnings(plan.components, event)
    if (lines.length === 0) continue

    // Record which money the percentage was taken from, and whether that number was
    // exact, so an amount can be explained without re-deriving it later.
    const annotated = lines.map((line) =>
      line.component_kind === "COMMISSION"
        ? {
            ...line,
            provenance: { resolved_from: value.source, approximated: value.approximated },
          }
        : line
    )

    inserted += await recordEarningLines({
      ownerUserId: row.owner_user_id,
      organizationId: row.organization_id,
      ref: earner.ref,
      workerUserId: earner.workerUserId,
      planId: plan.id,
      lines: annotated,
    })
    paid.push(earner.kind)
  }

  return { inserted, paid, skipped: value.cents.COLLECTED_TOTAL > 0 ? undefined : "worth_nothing" }
}

/** Fire-and-forget settlement for webhook and confirm paths. Never throws. */
export function settleJobEarningsInBackground(jobId: string): void {
  void settleJobEarnings({ jobId, paid: true })
    .then((result) => {
      if (result.inserted > 0) {
        console.log(
          JSON.stringify({
            zing: "compensation-job-settled",
            jobId,
            rows: result.inserted,
            paid: result.paid,
          })
        )
      }
    })
    .catch((e) => {
      console.error("[compensation] job settlement failed:", e)
    })
}

/**
 * Claw back everything earned on a job — a refund, or a job voided after settling.
 *
 * Writes negative twins rather than deleting, so the original amount and the reason
 * it went away both stay on the record.
 */
export async function reverseJobEarnings(
  jobId: string,
  reversedAtIso = new Date().toISOString()
): Promise<number> {
  const row = await loadJobRow(jobId)
  if (!row) return 0

  const refs: WorkerRef[] = []
  if (row.field_technician_id) {
    refs.push({ role: "field_tech", field_technician_id: row.field_technician_id })
  }
  if (row.booked_by_receptionist_id) {
    refs.push({ role: "receptionist", receptionist_id: row.booked_by_receptionist_id })
  }

  // Wide window: a refund can land long after the job settled.
  const start = new Date(0).toISOString()
  const end = new Date(Date.parse(reversedAtIso) + 24 * 60 * 60 * 1000).toISOString()

  let reversed = 0
  for (const ref of refs) {
    const rows = await listEarnings(ref, start, end)
    for (const entry of rows) {
      if (entry.source_kind !== "JOB" || entry.source_id !== jobId) continue
      if (entry.reversed_by || entry.reversal_of) continue
      const twin = await reverseEarningRow(entry.id, reversedAtIso)
      if (twin) reversed += 1
    }
  }
  return reversed
}
