/**
 * Amber workspace DB helpers (Phase 1).
 * Requires scripts/137-amber-assistant.sql in Neon.
 */

import { createHash, randomInt } from "crypto"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingAmberRelation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes("amber_workspaces") ||
    msg.includes("amber_mobile_verifications") ||
    msg.includes("amber_audit_events") ||
    msg.includes("is_amber_control")
  )
}

export type AmberWorkspaceRow = {
  id: string
  user_id: string
  organization_id: string | null
  phone_number_id: string
  enabled: boolean
  owner_mobile_e164: string | null
  owner_mobile_verified_at: string | null
  presence_available_at: string | null
  timezone: string
  amber_number: string | null
}

export function amberMigrationError(): Error {
  const err = new Error(
    "Amber tables missing — run scripts/137-amber-assistant.sql in Neon → SQL Editor."
  )
  ;(err as Error & { code?: string }).code = "AMBER_MIGRATION_REQUIRED"
  return err
}

/** Load Amber setup for a shop (joins control DID). */
export async function getAmberWorkspace(params: {
  userId: string
  organizationId?: string | null
}): Promise<AmberWorkspaceRow | null> {
  const sql = sqlClient()
  const orgId = params.organizationId?.trim() || null
  try {
    const rows = orgId
      ? await sql`
          SELECT
            a.id::text,
            a.user_id::text,
            a.organization_id::text,
            a.phone_number_id::text,
            a.enabled,
            a.owner_mobile_e164,
            a.owner_mobile_verified_at::text,
            a.presence_available_at::text,
            a.timezone,
            p.number AS amber_number
          FROM amber_workspaces a
          JOIN phone_numbers p ON p.id = a.phone_number_id
          WHERE a.user_id = ${params.userId}::uuid
            AND a.organization_id = ${orgId}::uuid
          LIMIT 1
        `
      : await sql`
          SELECT
            a.id::text,
            a.user_id::text,
            a.organization_id::text,
            a.phone_number_id::text,
            a.enabled,
            a.owner_mobile_e164,
            a.owner_mobile_verified_at::text,
            a.presence_available_at::text,
            a.timezone,
            p.number AS amber_number
          FROM amber_workspaces a
          JOIN phone_numbers p ON p.id = a.phone_number_id
          WHERE a.user_id = ${params.userId}::uuid
            AND a.organization_id IS NULL
          LIMIT 1
        `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return mapAmberRow(row)
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

/**
 * First enabled + verified Amber workspace for this account, regardless of organization.
 * Account-level alerts (carrier credit, billing) aren't org-scoped the way leftover-lead
 * pings are — an owner with multiple workspaces still has one carrier balance — so this
 * intentionally ignores organization_id, unlike getAmberWorkspace above.
 */
export async function getAnyEnabledAmberWorkspaceForOwner(
  userId: string
): Promise<AmberWorkspaceRow | null> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        a.id::text,
        a.user_id::text,
        a.organization_id::text,
        a.phone_number_id::text,
        a.enabled,
        a.owner_mobile_e164,
        a.owner_mobile_verified_at::text,
        a.presence_available_at::text,
        a.timezone,
        p.number AS amber_number
      FROM amber_workspaces a
      JOIN phone_numbers p ON p.id = a.phone_number_id
      WHERE a.user_id = ${userId}::uuid
        AND a.enabled = true
        AND a.owner_mobile_verified_at IS NOT NULL
      ORDER BY a.created_at ASC
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? mapAmberRow(row) : null
  } catch (e) {
    if (isMissingAmberRelation(e)) return null
    throw e
  }
}

/** Find Amber workspace by control DID (inbound SMS To). */
export async function getAmberWorkspaceByControlE164(
  toE164: string
): Promise<AmberWorkspaceRow | null> {
  const e164 = normalizePhoneNumberE164(toE164)
  if (!e164) return null
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        a.id::text,
        a.user_id::text,
        a.organization_id::text,
        a.phone_number_id::text,
        a.enabled,
        a.owner_mobile_e164,
        a.owner_mobile_verified_at::text,
        a.presence_available_at::text,
        a.timezone,
        p.number AS amber_number
      FROM amber_workspaces a
      JOIN phone_numbers p ON p.id = a.phone_number_id
      WHERE p.number = ${e164}
        AND p.is_amber_control = true
        AND a.enabled = true
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return mapAmberRow(row)
  } catch (e) {
    if (isMissingAmberRelation(e)) return null
    throw e
  }
}

function mapAmberRow(row: Record<string, unknown>): AmberWorkspaceRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    phone_number_id: String(row.phone_number_id),
    enabled: row.enabled === true || row.enabled === "t",
    owner_mobile_e164: row.owner_mobile_e164 != null ? String(row.owner_mobile_e164) : null,
    owner_mobile_verified_at:
      row.owner_mobile_verified_at != null ? String(row.owner_mobile_verified_at) : null,
    presence_available_at:
      row.presence_available_at != null ? String(row.presence_available_at) : null,
    timezone: String(row.timezone || "America/New_York"),
    amber_number: row.amber_number != null ? String(row.amber_number) : null,
  }
}

/** All Amber E.164s for an owner (exclude from customer From). */
export async function listAmberControlE164sForOwner(userId: string): Promise<string[]> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT p.number
      FROM phone_numbers p
      WHERE p.user_id = ${userId}::uuid
        AND p.is_amber_control = true
        AND p.status = 'active'
    `
    return rows
      .map((r) => normalizePhoneNumberE164(String((r as { number?: string }).number ?? "")))
      .filter(Boolean)
  } catch (e) {
    if (isMissingAmberRelation(e)) return []
    throw e
  }
}

/** Mark a phone_numbers row as Amber control. */
export async function markPhoneNumberAsAmberControl(phoneNumberId: string): Promise<void> {
  const sql = sqlClient()
  try {
    await sql`
      UPDATE phone_numbers
      SET is_amber_control = true
      WHERE id = ${phoneNumberId}::uuid
    `
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

/** Upsert Amber workspace after buying/assigning the control DID. */
export async function upsertAmberWorkspace(params: {
  userId: string
  organizationId: string | null
  phoneNumberId: string
  enabled: boolean
  timezone?: string
}): Promise<AmberWorkspaceRow> {
  const sql = sqlClient()
  const tz = params.timezone?.trim() || "America/New_York"
  try {
    if (params.organizationId) {
      await sql`
        INSERT INTO amber_workspaces (
          user_id, organization_id, phone_number_id, enabled, timezone, updated_at
        )
        VALUES (
          ${params.userId}::uuid,
          ${params.organizationId}::uuid,
          ${params.phoneNumberId}::uuid,
          ${params.enabled},
          ${tz},
          now()
        )
        ON CONFLICT (phone_number_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          timezone = EXCLUDED.timezone,
          updated_at = now()
      `
    } else {
      await sql`
        INSERT INTO amber_workspaces (
          user_id, organization_id, phone_number_id, enabled, timezone, updated_at
        )
        VALUES (
          ${params.userId}::uuid,
          NULL,
          ${params.phoneNumberId}::uuid,
          ${params.enabled},
          ${tz},
          now()
        )
        ON CONFLICT (phone_number_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          timezone = EXCLUDED.timezone,
          updated_at = now()
      `
    }
    const row = await getAmberWorkspace({
      userId: params.userId,
      organizationId: params.organizationId,
    })
    if (!row) throw new Error("Amber workspace missing after upsert")
    return row
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

export async function setAmberEnabled(params: {
  userId: string
  organizationId: string | null
  enabled: boolean
}): Promise<void> {
  const sql = sqlClient()
  try {
    if (params.organizationId) {
      await sql`
        UPDATE amber_workspaces
        SET enabled = ${params.enabled}, updated_at = now()
        WHERE user_id = ${params.userId}::uuid
          AND organization_id = ${params.organizationId}::uuid
      `
    } else {
      await sql`
        UPDATE amber_workspaces
        SET enabled = ${params.enabled}, updated_at = now()
        WHERE user_id = ${params.userId}::uuid
          AND organization_id IS NULL
      `
    }
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

export async function setAmberOwnerMobileVerified(params: {
  userId: string
  organizationId: string | null
  mobileE164: string
}): Promise<void> {
  const mobile = normalizePhoneNumberE164(params.mobileE164)
  const sql = sqlClient()
  try {
    if (params.organizationId) {
      await sql`
        UPDATE amber_workspaces
        SET
          owner_mobile_e164 = ${mobile},
          owner_mobile_verified_at = now(),
          updated_at = now()
        WHERE user_id = ${params.userId}::uuid
          AND organization_id = ${params.organizationId}::uuid
      `
    } else {
      await sql`
        UPDATE amber_workspaces
        SET
          owner_mobile_e164 = ${mobile},
          owner_mobile_verified_at = now(),
          updated_at = now()
        WHERE user_id = ${params.userId}::uuid
          AND organization_id IS NULL
      `
    }
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

export async function setAmberPresenceAvailableAt(params: {
  amberWorkspaceId: string
  availableAt: Date | null
}): Promise<void> {
  const sql = sqlClient()
  try {
    if (params.availableAt) {
      await sql`
        UPDATE amber_workspaces
        SET presence_available_at = ${params.availableAt.toISOString()}::timestamptz,
            updated_at = now()
        WHERE id = ${params.amberWorkspaceId}::uuid
      `
    } else {
      await sql`
        UPDATE amber_workspaces
        SET presence_available_at = NULL, updated_at = now()
        WHERE id = ${params.amberWorkspaceId}::uuid
      `
    }
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

/** Workspaces due for auto-Available. */
export async function listAmberDueForAvailable(now = new Date()): Promise<AmberWorkspaceRow[]> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        a.id::text,
        a.user_id::text,
        a.organization_id::text,
        a.phone_number_id::text,
        a.enabled,
        a.owner_mobile_e164,
        a.owner_mobile_verified_at::text,
        a.presence_available_at::text,
        a.timezone,
        p.number AS amber_number
      FROM amber_workspaces a
      JOIN phone_numbers p ON p.id = a.phone_number_id
      WHERE a.enabled = true
        AND a.presence_available_at IS NOT NULL
        AND a.presence_available_at <= ${now.toISOString()}::timestamptz
      LIMIT 50
    `
    return (rows as Record<string, unknown>[]).map(mapAmberRow)
  } catch (e) {
    if (isMissingAmberRelation(e)) return []
    throw e
  }
}

/** Soonest future Busy-until for this owner (any enabled Amber workspace). */
export async function getAmberBusyUntilForOwner(
  userId: string
): Promise<{ availableAt: string; timezone: string } | null> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT
        a.presence_available_at::text AS available_at,
        a.timezone
      FROM amber_workspaces a
      WHERE a.user_id = ${userId}::uuid
        AND a.enabled = true
        AND a.presence_available_at IS NOT NULL
        AND a.presence_available_at > now()
      ORDER BY a.presence_available_at ASC
      LIMIT 1
    `
    const row = rows[0] as { available_at?: string; timezone?: string } | undefined
    if (!row?.available_at) return null
    return {
      availableAt: String(row.available_at),
      timezone: String(row.timezone || "America/New_York"),
    }
  } catch (e) {
    if (isMissingAmberRelation(e)) return null
    throw e
  }
}

/** Clear Busy-until timers when the owner flips Available in the app. */
export async function clearAmberPresenceUntilForOwner(userId: string): Promise<void> {
  const sql = sqlClient()
  try {
    await sql`
      UPDATE amber_workspaces
      SET presence_available_at = NULL, updated_at = now()
      WHERE user_id = ${userId}::uuid
        AND presence_available_at IS NOT NULL
    `
  } catch (e) {
    if (isMissingAmberRelation(e)) return
    throw e
  }
}

export async function insertAmberAuditEvent(params: {
  userId: string
  organizationId?: string | null
  eventType: string
  detail?: Record<string, unknown>
}): Promise<void> {
  const sql = sqlClient()
  try {
    await sql`
      INSERT INTO amber_audit_events (user_id, organization_id, event_type, detail)
      VALUES (
        ${params.userId}::uuid,
        ${params.organizationId ?? null}::uuid,
        ${params.eventType},
        ${JSON.stringify(params.detail ?? {})}::jsonb
      )
    `
  } catch (e) {
    if (isMissingAmberRelation(e)) return
    console.warn("[amber-audit] insert failed:", e)
  }
}

export function hashAmberVerifyCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex")
}

export function generateAmberVerifyCode(): string {
  return String(randomInt(100000, 999999))
}

export async function createAmberMobileVerification(params: {
  userId: string
  organizationId: string | null
  mobileE164: string
  code: string
  ttlMinutes?: number
}): Promise<{ expiresAt: string }> {
  const sql = sqlClient()
  const mobile = normalizePhoneNumberE164(params.mobileE164)
  const ttl = Math.min(Math.max(params.ttlMinutes ?? 10, 5), 30)
  const expires = new Date(Date.now() + ttl * 60_000)
  try {
    await sql`
      DELETE FROM amber_mobile_verifications
      WHERE user_id = ${params.userId}::uuid
        AND mobile_e164 = ${mobile}
    `
    if (params.organizationId) {
      await sql`
        INSERT INTO amber_mobile_verifications (
          user_id, organization_id, mobile_e164, code_hash, expires_at
        )
        VALUES (
          ${params.userId}::uuid,
          ${params.organizationId}::uuid,
          ${mobile},
          ${hashAmberVerifyCode(params.code)},
          ${expires.toISOString()}::timestamptz
        )
      `
    } else {
      await sql`
        INSERT INTO amber_mobile_verifications (
          user_id, organization_id, mobile_e164, code_hash, expires_at
        )
        VALUES (
          ${params.userId}::uuid,
          NULL,
          ${mobile},
          ${hashAmberVerifyCode(params.code)},
          ${expires.toISOString()}::timestamptz
        )
      `
    }
    return { expiresAt: expires.toISOString() }
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

export async function consumeAmberMobileVerification(params: {
  userId: string
  mobileE164: string
  code: string
}): Promise<boolean> {
  const sql = sqlClient()
  const mobile = normalizePhoneNumberE164(params.mobileE164)
  const hash = hashAmberVerifyCode(params.code)
  try {
    const rows = await sql`
      DELETE FROM amber_mobile_verifications
      WHERE id = (
        SELECT id FROM amber_mobile_verifications
        WHERE user_id = ${params.userId}::uuid
          AND mobile_e164 = ${mobile}
          AND code_hash = ${hash}
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    if (isMissingAmberRelation(e)) throw amberMigrationError()
    throw e
  }
}

/** Lookup phone_numbers.id by E.164 for owner. */
export async function findActivePhoneNumberIdForOwner(params: {
  userId: string
  e164: string
  organizationId?: string | null
}): Promise<string | null> {
  const sql = sqlClient()
  const e164 = normalizePhoneNumberE164(params.e164)
  const orgId = params.organizationId?.trim() || null
  try {
    const rows = orgId
      ? await sql`
          SELECT id::text FROM phone_numbers
          WHERE user_id = ${params.userId}::uuid
            AND number = ${e164}
            AND status = 'active'
            AND organization_id = ${orgId}::uuid
          LIMIT 1
        `
      : await sql`
          SELECT id::text FROM phone_numbers
          WHERE user_id = ${params.userId}::uuid
            AND number = ${e164}
            AND status = 'active'
          LIMIT 1
        `
    return rows[0] ? String((rows[0] as { id: string }).id) : null
  } catch {
    return null
  }
}
