// Persist + query lost-lead rows for price-shopper recovery SMS.

import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { neon } from "@neondatabase/serverless"
import { normalizePhoneNumberE164 } from "@/lib/db"

export type LostLeadRow = {
  id: string
  user_id: string
  organization_id: string | null
  call_log_id: string | null
  phone_number: string
  last_quoted_price_cents: number | null
  failure_reason: string
  status: string
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  service_type: string | null
  collected: Record<string, unknown>
  recovery_sms_sent_at: string | null
  recovery_sms_body: string | null
  recovery_sms_error: string | null
  created_at: string
}

export type InsertLostLeadInput = {
  ownerUserId: string
  organizationId?: string | null
  callLogId?: string | null
  phoneNumber: string
  lastQuotedPriceCents?: number | null
  failureReason: string
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  serviceType?: string | null
  collected?: Record<string, unknown>
}

let cachedSql: ReturnType<typeof neon> | null = null

function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function isUndefinedRelationError(e: unknown, table: string): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes(`relation "${table}" does not exist`) || msg.includes(`"${table}" does not exist`)
}

export async function insertLostLead(input: InsertLostLeadInput): Promise<{ id: string }> {
  const phone = normalizePhoneNumberE164(input.phoneNumber)
  const id = crypto.randomUUID()
  const orgId = input.organizationId?.trim() || null
  const collectedJson = JSON.stringify(input.collected ?? {})

  const sql = getSql()
  try {
    if (orgId) {
      await sql`
        INSERT INTO lost_leads (
          id, user_id, organization_id, call_log_id, phone_number,
          last_quoted_price_cents, failure_reason, status,
          vehicle_year, vehicle_make, vehicle_model, service_type, collected
        ) VALUES (
          ${id}::uuid, ${input.ownerUserId}::uuid, ${orgId}::uuid,
          ${input.callLogId?.trim() || null}, ${phone},
          ${input.lastQuotedPriceCents ?? null}, ${input.failureReason.trim()},
          'lost_lead',
          ${input.vehicleYear?.trim() || null},
          ${input.vehicleMake?.trim() || null},
          ${input.vehicleModel?.trim() || null},
          ${input.serviceType?.trim() || null},
          ${collectedJson}::jsonb
        )
      `
    } else {
      await sql`
        INSERT INTO lost_leads (
          id, user_id, call_log_id, phone_number,
          last_quoted_price_cents, failure_reason, status,
          vehicle_year, vehicle_make, vehicle_model, service_type, collected
        ) VALUES (
          ${id}::uuid, ${input.ownerUserId}::uuid,
          ${input.callLogId?.trim() || null}, ${phone},
          ${input.lastQuotedPriceCents ?? null}, ${input.failureReason.trim()},
          'lost_lead',
          ${input.vehicleYear?.trim() || null},
          ${input.vehicleMake?.trim() || null},
          ${input.vehicleModel?.trim() || null},
          ${input.serviceType?.trim() || null},
          ${collectedJson}::jsonb
        )
      `
    }
    return { id }
  } catch (e) {
    if (isUndefinedRelationError(e, "lost_leads")) {
      throw new Error("Lost leads table missing — run scripts/084-lost-leads-recovery.sql in Neon.")
    }
    throw e
  }
}

/** Rows eligible for recovery SMS (older than minAgeMinutes, not yet sent). */
export async function listLostLeadsPendingRecovery(minAgeMinutes: number, limit = 25): Promise<LostLeadRow[]> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        id::text AS id,
        user_id::text AS user_id,
        organization_id::text AS organization_id,
        call_log_id,
        phone_number,
        last_quoted_price_cents,
        failure_reason,
        status,
        vehicle_year,
        vehicle_make,
        vehicle_model,
        service_type,
        collected,
        recovery_sms_sent_at::text AS recovery_sms_sent_at,
        recovery_sms_body,
        recovery_sms_error,
        created_at::text AS created_at
      FROM lost_leads
      WHERE status = 'lost_lead'
        AND recovery_sms_sent_at IS NULL
        AND created_at <= now() - (${minAgeMinutes} * interval '1 minute')
      ORDER BY created_at ASC
      LIMIT ${limit}
    `
    return rows as LostLeadRow[]
  } catch (e) {
    if (isUndefinedRelationError(e, "lost_leads")) return []
    throw e
  }
}

/** Active lost-lead rows surfaced in the unified salvage dashboard. */
export async function listLostLeadsForSalvagePool(ownerUserId: string, limit = 25): Promise<LostLeadRow[]> {
  const sql = getSql()
  const lim = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await sql`
      SELECT
        id::text AS id,
        user_id::text AS user_id,
        organization_id::text AS organization_id,
        call_log_id,
        phone_number,
        last_quoted_price_cents,
        failure_reason,
        status,
        vehicle_year,
        vehicle_make,
        vehicle_model,
        service_type,
        collected,
        recovery_sms_sent_at::text AS recovery_sms_sent_at,
        recovery_sms_body,
        recovery_sms_error,
        created_at::text AS created_at
      FROM lost_leads
      WHERE user_id = ${ownerUserId}::uuid
        AND status IN ('lost_lead', 'failed_10dlc')
      ORDER BY created_at DESC
      LIMIT ${lim}
    `
    return rows as LostLeadRow[]
  } catch (e) {
    if (isUndefinedRelationError(e, "lost_leads")) return []
    throw e
  }
}

export type LostLeadRecoveryStatus = "recovery_sent" | "lost_lead" | "failed_10dlc"

export async function markLostLeadRecoverySms(params: {
  id: string
  body: string
  error?: string | null
  status?: LostLeadRecoveryStatus
}): Promise<void> {
  const sql = getSql()
  const nextStatus: LostLeadRecoveryStatus = params.status ?? (params.error ? "lost_lead" : "recovery_sent")
  const hasError = Boolean(params.error)
  try {
    if (hasError) {
      await sql`
        UPDATE lost_leads
        SET
          recovery_sms_sent_at = NULL,
          recovery_sms_body = ${params.body},
          recovery_sms_error = ${params.error ?? null},
          status = ${nextStatus}
        WHERE id = ${params.id}::uuid
      `
    } else {
      await sql`
        UPDATE lost_leads
        SET
          recovery_sms_sent_at = now(),
          recovery_sms_body = ${params.body},
          recovery_sms_error = NULL,
          status = ${nextStatus}
        WHERE id = ${params.id}::uuid
      `
    }
  } catch (e) {
    if (isUndefinedRelationError(e, "lost_leads")) return
    throw e
  }
}

/** Mark automated SMS blocked by carrier 10DLC — dispatcher must retry manually. */
export async function markLostLeadFailed10Dlc(params: {
  id: string
  body: string
  error: string
}): Promise<void> {
  const sql = getSql()
  try {
    await sql`
      UPDATE lost_leads
      SET
        recovery_sms_sent_at = NULL,
        recovery_sms_body = ${params.body},
        recovery_sms_error = ${params.error},
        status = 'failed_10dlc'
      WHERE id = ${params.id}::uuid
    `
  } catch (e) {
    if (isUndefinedRelationError(e, "lost_leads")) return
    throw e
  }
}
