// ============================================
// Agreement storage (native Neon SQL — no ORM)
// ============================================
// A signed row is never rewritten. Signing fills in the signature fields on a PENDING
// row; it does not re-render the body, because the body is what was agreed to.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  parsePayComponents,
  type EmploymentType,
  type PayComponent,
} from "@/lib/compensation/plan-schema"
import { renderAgreement } from "@/lib/agreements/render"
import type { AgreementKind } from "@/lib/agreements/templates"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function pgErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : ""
}

function isMissingAgreementsTable(e: unknown): boolean {
  if (pgErrorCode(e) === "42P01") return true
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes("worker_agreements") && msg.includes("does not exist")
}

const MISSING_AGREEMENTS_MESSAGE =
  "Agreements aren't set up yet — run scripts/147-worker-agreements.sql in Neon → SQL Editor."

type AgreementStatus = "PENDING" | "SIGNED" | "DECLINED" | "VOID"

export interface WorkerAgreement {
  id: string
  owner_user_id: string
  worker_user_id: string | null
  worker_role: "receptionist" | "field_tech"
  receptionist_id: string | null
  field_technician_id: string | null
  invite_id: string | null
  plan_id: string | null
  employment_type: "W2_EMPLOYEE" | "CONTRACTOR_1099"
  status: AgreementStatus
  rendered_body: string
  body_sha256: string
  pay_summary: string
  plan_components: PayComponent[]
  pdf_blob_url: string | null
  signer_name: string | null
  signed_at: string | null
  created_at: string
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function parseRow(row: Record<string, unknown>): WorkerAgreement {
  const status = String(row.status ?? "PENDING").toUpperCase()
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    worker_user_id: row.worker_user_id ? String(row.worker_user_id) : null,
    worker_role: String(row.worker_role) === "field_tech" ? "field_tech" : "receptionist",
    receptionist_id: row.receptionist_id ? String(row.receptionist_id) : null,
    field_technician_id: row.field_technician_id ? String(row.field_technician_id) : null,
    invite_id: row.invite_id ? String(row.invite_id) : null,
    plan_id: row.plan_id ? String(row.plan_id) : null,
    employment_type:
      String(row.employment_type) === "W2_EMPLOYEE" ? "W2_EMPLOYEE" : "CONTRACTOR_1099",
    status: (["SIGNED", "DECLINED", "VOID"].includes(status)
      ? status
      : "PENDING") as AgreementStatus,
    rendered_body: String(row.rendered_body ?? ""),
    body_sha256: String(row.body_sha256 ?? ""),
    pay_summary: String(row.pay_summary ?? ""),
    plan_components: parsePayComponents(row.plan_components),
    pdf_blob_url: row.pdf_blob_url ? String(row.pdf_blob_url) : null,
    signer_name: row.signer_name ? String(row.signer_name) : null,
    signed_at: isoOrNull(row.signed_at),
    created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
  }
}

/**
 * Create the agreement an invitee will be asked to sign.
 *
 * Rendered and frozen here, at invite time, so what the owner set is what the worker
 * sees — not whatever the plan happens to say by the time they open the link.
 */
export async function createPendingAgreement(params: {
  ownerUserId: string
  organizationId?: string | null
  businessName: string
  workerName: string
  workerRole: "receptionist" | "field_tech"
  employmentType: EmploymentType
  components: PayComponent[]
  inviteId?: string | null
  planId?: string | null
  receptionistId?: string | null
  fieldTechnicianId?: string | null
  kind?: AgreementKind
  startDateIso?: string
}): Promise<WorkerAgreement> {
  if (params.employmentType === "UNSPECIFIED") {
    throw new Error("Set the worker's employment type before sending an agreement.")
  }

  const rendered = renderAgreement(
    {
      businessName: params.businessName,
      workerName: params.workerName,
      workerRole: params.workerRole,
      employmentType: params.employmentType,
      components: params.components,
      startDateIso: params.startDateIso ?? new Date().toISOString(),
    },
    params.kind
  )

  const sql = getSql()
  try {
    // Re-sending an invite must reuse the pending agreement rather than stack another.
    const rows = (await sql`
      INSERT INTO worker_agreements (
        owner_user_id, organization_id, worker_role,
        receptionist_id, field_technician_id,
        invite_id, plan_id, employment_type, status,
        rendered_body, body_sha256, pay_summary, plan_components
      )
      VALUES (
        ${params.ownerUserId},
        ${params.organizationId ?? null},
        ${params.workerRole},
        ${params.receptionistId ?? null},
        ${params.fieldTechnicianId ?? null},
        ${params.inviteId ?? null},
        ${params.planId ?? null},
        ${params.employmentType},
        'PENDING',
        ${rendered.body},
        ${rendered.sha256},
        ${rendered.paySummary},
        ${JSON.stringify(params.components)}::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `) as Record<string, unknown>[]
    if (rows[0]) return parseRow(rows[0])

    if (params.inviteId) {
      const existing = await getPendingAgreementForInvite(params.inviteId)
      if (existing) return existing
    }
    throw new Error("Could not create the agreement.")
  } catch (e) {
    if (isMissingAgreementsTable(e)) throw new Error(MISSING_AGREEMENTS_MESSAGE)
    throw e
  }
}

/** The agreement waiting on an invite, if any. */
export async function getPendingAgreementForInvite(
  inviteId: string
): Promise<WorkerAgreement | null> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT * FROM worker_agreements
      WHERE invite_id = ${inviteId} AND status = 'PENDING'
      LIMIT 1
    `) as Record<string, unknown>[]
    return rows[0] ? parseRow(rows[0]) : null
  } catch (e) {
    if (isMissingAgreementsTable(e)) return null
    throw e
  }
}

/**
 * Sign a pending agreement.
 *
 * The body is untouched — signing records who agreed and under what circumstances,
 * not what was agreed. Consent to transact electronically is required separately from
 * the signature itself, which is what ESIGN asks for.
 */
export async function signAgreement(params: {
  agreementId: string
  signerName: string
  signatureType: "TYPED" | "DRAWN"
  signatureData: string
  consentElectronic: boolean
  workerUserId?: string | null
  receptionistId?: string | null
  fieldTechnicianId?: string | null
  ip?: string | null
  userAgent?: string | null
}): Promise<WorkerAgreement | null> {
  if (!params.consentElectronic) {
    throw new Error("Agree to sign electronically before signing.")
  }
  if (params.signerName.trim().length < 2) {
    throw new Error("Type your full name to sign.")
  }

  const sql = getSql()
  try {
    const rows = (await sql`
      UPDATE worker_agreements
      SET status = 'SIGNED',
          signer_name = ${params.signerName.trim()},
          signature_type = ${params.signatureType},
          signature_data = ${params.signatureData},
          consent_electronic = true,
          signed_at = now(),
          signed_ip = ${params.ip ?? null},
          signed_user_agent = ${(params.userAgent ?? "").slice(0, 500) || null},
          worker_user_id = COALESCE(${params.workerUserId ?? null}, worker_user_id),
          receptionist_id = COALESCE(${params.receptionistId ?? null}, receptionist_id),
          field_technician_id = COALESCE(${params.fieldTechnicianId ?? null}, field_technician_id)
      WHERE id = ${params.agreementId} AND status = 'PENDING'
      RETURNING *
    `) as Record<string, unknown>[]
    return rows[0] ? parseRow(rows[0]) : null
  } catch (e) {
    if (isMissingAgreementsTable(e)) throw new Error(MISSING_AGREEMENTS_MESSAGE)
    throw e
  }
}

/** Point a signed agreement at the plan version it covers. */
export async function attachAgreementPlan(agreementId: string, planId: string): Promise<void> {
  const sql = getSql()
  try {
    await sql`UPDATE worker_agreements SET plan_id = ${planId} WHERE id = ${agreementId}`
  } catch (e) {
    if (isMissingAgreementsTable(e)) return
    throw e
  }
}
