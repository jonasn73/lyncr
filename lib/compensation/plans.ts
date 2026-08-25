// ============================================
// Compensation plan storage (native Neon SQL — no ORM)
// ============================================
// Reads and versioned writes against compensation_plans (scripts/144).
//
// The one rule this module enforces: a plan is never updated in place. Changing
// someone's pay closes the live row and opens a new one, so earnings already written
// keep pointing at the version that produced them.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  legacyReceptionistComponents,
  parsePayComponents,
  validatePayComponents,
  type CompensationPlan,
  type EmploymentType,
  type PayComponent,
  type WorkerRef,
} from "@/lib/compensation/plan-schema"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function pgErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
}

/** True when compensation_plans has not been created yet. */
function isMissingPlansTable(e: unknown): boolean {
  if (pgErrorCode(e) === "42P01") return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes("compensation_plans") && msg.includes("does not exist")
}

const MISSING_TABLE_MESSAGE =
  "Pay plans aren't set up yet — run scripts/144-compensation-plans.sql in Neon → SQL Editor."

function isoOrNull(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function parsePlanRow(row: Record<string, unknown>): CompensationPlan {
  const role = String(row.worker_role) === "field_tech" ? "field_tech" : "receptionist"
  const employment = String(row.employment_type ?? "UNSPECIFIED").toUpperCase()
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    organization_id: row.organization_id ? String(row.organization_id) : null,
    worker_role: role,
    receptionist_id: row.receptionist_id ? String(row.receptionist_id) : null,
    field_technician_id: row.field_technician_id ? String(row.field_technician_id) : null,
    worker_user_id: row.worker_user_id ? String(row.worker_user_id) : null,
    employment_type: (["W2_EMPLOYEE", "CONTRACTOR_1099"].includes(employment)
      ? employment
      : "UNSPECIFIED") as EmploymentType,
    components: parsePayComponents(row.components),
    currency: String(row.currency ?? "USD"),
    effective_from: isoOrNull(row.effective_from) ?? new Date(0).toISOString(),
    effective_to: isoOrNull(row.effective_to),
    superseded_by: row.superseded_by ? String(row.superseded_by) : null,
    agreement_id: row.agreement_id ? String(row.agreement_id) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
  }
}

/** The live plan for a worker, or null when they have none. */
export async function getLivePlan(ref: WorkerRef): Promise<CompensationPlan | null> {
  const sql = getSql()
  try {
    const rows =
      ref.role === "receptionist"
        ? ((await sql`
            SELECT * FROM compensation_plans
            WHERE receptionist_id = ${ref.receptionist_id} AND effective_to IS NULL
            LIMIT 1
          `) as Record<string, unknown>[])
        : ((await sql`
            SELECT * FROM compensation_plans
            WHERE field_technician_id = ${ref.field_technician_id} AND effective_to IS NULL
            LIMIT 1
          `) as Record<string, unknown>[])
    return rows[0] ? parsePlanRow(rows[0]) : null
  } catch (e) {
    if (isMissingPlansTable(e)) return null
    throw e
  }
}

/**
 * The plan version in force at a moment in time.
 *
 * Used when writing a ledger row for an event that already happened — a backfill, a
 * late webhook — so the amount matches what the worker was on at the time rather
 * than what they are on now.
 */
export async function getPlanInForceAt(
  ref: WorkerRef,
  at: string
): Promise<CompensationPlan | null> {
  const sql = getSql()
  try {
    const rows =
      ref.role === "receptionist"
        ? ((await sql`
            SELECT * FROM compensation_plans
            WHERE receptionist_id = ${ref.receptionist_id}
              AND effective_from <= ${at}::timestamptz
              AND (effective_to IS NULL OR effective_to > ${at}::timestamptz)
            ORDER BY effective_from DESC
            LIMIT 1
          `) as Record<string, unknown>[])
        : ((await sql`
            SELECT * FROM compensation_plans
            WHERE field_technician_id = ${ref.field_technician_id}
              AND effective_from <= ${at}::timestamptz
              AND (effective_to IS NULL OR effective_to > ${at}::timestamptz)
            ORDER BY effective_from DESC
            LIMIT 1
          `) as Record<string, unknown>[])
    return rows[0] ? parsePlanRow(rows[0]) : null
  } catch (e) {
    if (isMissingPlansTable(e)) return null
    throw e
  }
}

/** Every live plan for an owner, optionally scoped to one workspace. */
export async function listLivePlansForOwner(
  ownerUserId: string,
  organizationId?: string | null
): Promise<CompensationPlan[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT * FROM compensation_plans
      WHERE owner_user_id = ${ownerUserId}
        AND effective_to IS NULL
        AND (${organizationId ?? null}::uuid IS NULL OR organization_id = ${organizationId ?? null}::uuid)
      ORDER BY worker_role ASC, created_at ASC
    `) as Record<string, unknown>[]
    return rows.map(parsePlanRow)
  } catch (e) {
    if (isMissingPlansTable(e)) return []
    throw e
  }
}

/** Every version for one worker, newest first — the audit trail behind a payout. */
export async function listPlanHistory(ref: WorkerRef): Promise<CompensationPlan[]> {
  const sql = getSql()
  try {
    const rows =
      ref.role === "receptionist"
        ? ((await sql`
            SELECT * FROM compensation_plans
            WHERE receptionist_id = ${ref.receptionist_id}
            ORDER BY effective_from DESC
          `) as Record<string, unknown>[])
        : ((await sql`
            SELECT * FROM compensation_plans
            WHERE field_technician_id = ${ref.field_technician_id}
            ORDER BY effective_from DESC
          `) as Record<string, unknown>[])
    return rows.map(parsePlanRow)
  } catch (e) {
    if (isMissingPlansTable(e)) return []
    throw e
  }
}

/**
 * Components to pay a receptionist by, falling back to their legacy columns.
 *
 * Everything on the roster got a plan in the scripts/144 backfill, so the fallback
 * only covers receptionists added between the migration running and the plan editor
 * shipping. It reproduces the old two-mode behavior exactly.
 */
export async function resolveReceptionistComponents(receptionist: {
  id: string
  pay_mode?: string | null
  rate_per_minute?: number | null
  flat_rate_usd?: number | null
}): Promise<{ plan: CompensationPlan | null; components: PayComponent[] }> {
  const plan = await getLivePlan({ role: "receptionist", receptionist_id: receptionist.id })
  if (plan && plan.components.length > 0) return { plan, components: plan.components }
  return { plan, components: legacyReceptionistComponents(receptionist) }
}

export interface SavePlanInput {
  ownerUserId: string
  organizationId?: string | null
  ref: WorkerRef
  /** The worker's login, when they have one. Phone-contact receptionists have none. */
  workerUserId?: string | null
  employmentType: EmploymentType
  components: PayComponent[]
  /** When the new rate starts. Defaults to now; never backdated past existing earnings. */
  effectiveFrom?: string
  agreementId?: string | null
  createdBy: string
}

export class CompensationPlanError extends Error {
  readonly status: number
  readonly details: string[]

  constructor(message: string, status = 400, details: string[] = []) {
    super(message)
    this.name = "CompensationPlanError"
    this.status = status
    this.details = details
  }
}

/**
 * Supersede a worker's plan with a new version.
 *
 * Three sequential writes — close the live row, insert the replacement, link them —
 * because the Neon HTTP driver is not a single interactive transaction. If the
 * insert fails the close is undone, so a worker is never left with no live plan.
 */
export async function savePlan(input: SavePlanInput): Promise<CompensationPlan> {
  const validation = validatePayComponents(input.components, {
    employmentType: input.employmentType,
  })
  if (validation.errors.length > 0) {
    throw new CompensationPlanError("This pay plan can't be saved.", 400, validation.errors)
  }

  const sql = getSql()
  const effectiveFrom = input.effectiveFrom ?? new Date().toISOString()
  const receptionistId = input.ref.role === "receptionist" ? input.ref.receptionist_id : null
  const technicianId = input.ref.role === "field_tech" ? input.ref.field_technician_id : null

  let closedPlanId: string | null = null

  try {
    const closed = (await sql`
      UPDATE compensation_plans
      SET effective_to = ${effectiveFrom}::timestamptz
      WHERE effective_to IS NULL
        AND (
          (${receptionistId}::uuid IS NOT NULL AND receptionist_id = ${receptionistId}::uuid)
          OR (${technicianId}::uuid IS NOT NULL AND field_technician_id = ${technicianId}::uuid)
        )
        AND effective_from < ${effectiveFrom}::timestamptz
      RETURNING id
    `) as Record<string, unknown>[]
    closedPlanId = closed[0] ? String(closed[0].id) : null
  } catch (e) {
    if (isMissingPlansTable(e)) throw new CompensationPlanError(MISSING_TABLE_MESSAGE, 500)
    throw e
  }

  try {
    const rows = (await sql`
      INSERT INTO compensation_plans (
        owner_user_id, organization_id, worker_role,
        receptionist_id, field_technician_id, worker_user_id,
        employment_type, components, effective_from, agreement_id, created_by
      )
      VALUES (
        ${input.ownerUserId},
        ${input.organizationId ?? null},
        ${input.ref.role},
        ${receptionistId},
        ${technicianId},
        ${input.workerUserId ?? null},
        ${input.employmentType},
        ${JSON.stringify(input.components)}::jsonb,
        ${effectiveFrom}::timestamptz,
        ${input.agreementId ?? null},
        ${input.createdBy}
      )
      RETURNING *
    `) as Record<string, unknown>[]

    const plan = parsePlanRow(rows[0])

    if (closedPlanId) {
      await sql`
        UPDATE compensation_plans
        SET superseded_by = ${plan.id}
        WHERE id = ${closedPlanId}
      `
    }

    return plan
  } catch (e) {
    // Reopen the version we just closed rather than leaving the worker unpaid.
    if (closedPlanId) {
      await sql`
        UPDATE compensation_plans
        SET effective_to = NULL, superseded_by = NULL
        WHERE id = ${closedPlanId}
      `.catch(() => undefined)
    }
    if (isMissingPlansTable(e)) throw new CompensationPlanError(MISSING_TABLE_MESSAGE, 500)
    throw e
  }
}

/** Link a signed agreement to the plan version it covers (phase 6). */
export async function attachAgreementToPlan(planId: string, agreementId: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE compensation_plans SET agreement_id = ${agreementId} WHERE id = ${planId}
    `
  } catch (e) {
    if (isMissingPlansTable(e)) return
    throw e
  }
}
