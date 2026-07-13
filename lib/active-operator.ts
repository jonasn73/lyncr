// Team roles + active operator dial target for Telnyx <Dial>.
// Canonical labels: OWNER | RECEPTIONIST | TECHNICIAN (DB stores lowercase).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { toE164 } from "@/lib/phone-e164"
import type { AccountRole } from "@/lib/types"

/** Public / product-facing role labels. */
export type TeamRoleLabel = "OWNER" | "RECEPTIONIST" | "TECHNICIAN"

/** Normalize any raw role string into the DB AccountRole union (defaults to owner). */
export function normalizeAccountRoleValue(raw: unknown): AccountRole {
  const v = String(raw ?? "owner")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
  if (v === "receptionist") return "receptionist"
  if (v === "field_tech" || v === "technician" || v === "tech") return "field_tech"
  if (v === "owner") return "owner"
  // Accept uppercase product labels without lowercasing twice.
  const upper = String(raw ?? "").trim().toUpperCase()
  if (upper === "RECEPTIONIST") return "receptionist"
  if (upper === "TECHNICIAN" || upper === "FIELD_TECH") return "field_tech"
  if (upper === "OWNER") return "owner"
  return "owner"
}

/** Map DB role → product enum label. */
export function toTeamRoleLabel(role: AccountRole | string | null | undefined): TeamRoleLabel {
  const n = normalizeAccountRoleValue(role)
  if (n === "receptionist") return "RECEPTIONIST"
  if (n === "field_tech") return "TECHNICIAN"
  return "OWNER"
}

export type ActiveOperator = {
  userId: string
  phoneE164: string
  role: AccountRole
  roleLabel: TeamRoleLabel
}

function sql() {
  return neon(resolveNeonDatabaseUrl())
}

function asE164(raw: string | null | undefined): string {
  if (!raw?.trim()) return ""
  return normalizePhoneNumberE164(raw) || toE164(raw) || ""
}

/**
 * Prefer an AVAILABLE receptionist on this owner's team, else the OWNER cell.
 * Presence comes from account_settings (missing row = AVAILABLE).
 */
export async function findActiveOperatorForAccount(
  ownerUserId: string
): Promise<ActiveOperator | null> {
  if (!ownerUserId.trim()) return null

  try {
    // 1) Available receptionist portal users linked to this owner's roster.
    const receptionistRows = await sql()`
      SELECT
        u.id AS user_id,
        COALESCE(
          NULLIF(trim(u.phone), ''),
          NULLIF(trim(r.phone), '')
        ) AS phone
      FROM receptionists r
      INNER JOIN users u ON u.id = r.portal_user_id
      LEFT JOIN account_settings s ON s.user_id = u.id
      WHERE r.user_id = ${ownerUserId}
        AND r.is_active = true
        AND r.portal_user_id IS NOT NULL
        AND lower(coalesce(u.account_role, 'receptionist')) IN ('receptionist')
        AND coalesce(s.presence_status, 'AVAILABLE') = 'AVAILABLE'
        AND COALESCE(
          NULLIF(trim(u.phone), ''),
          NULLIF(trim(r.phone), '')
        ) IS NOT NULL
      ORDER BY r.created_at ASC
      LIMIT 1
    `
    const recv = receptionistRows[0] as { user_id?: string; phone?: string | null } | undefined
    const recvPhone = asE164(recv?.phone)
    if (recv?.user_id && recvPhone) {
      return {
        userId: String(recv.user_id),
        phoneE164: recvPhone,
        role: "receptionist",
        roleLabel: "RECEPTIONIST",
      }
    }
  } catch (e) {
    console.warn("[active-operator] receptionist lookup failed:", e)
  }

  try {
    // 2) Owner (or custom routing cell on the owner account).
    const ownerRows = await sql()`
      SELECT
        u.id AS user_id,
        NULLIF(trim(u.phone), '') AS owner_phone,
        NULLIF(trim(rc.custom_routing_phone), '') AS custom_phone
      FROM users u
      LEFT JOIN routing_config rc
        ON rc.user_id = u.id AND rc.business_number IS NULL
      WHERE u.id = ${ownerUserId}
      LIMIT 1
    `
    const row = ownerRows[0] as
      | { user_id?: string; owner_phone?: string | null; custom_phone?: string | null }
      | undefined
    if (!row?.user_id) return null
    const custom = asE164(row.custom_phone)
    const owner = asE164(row.owner_phone)
    const phone = custom || owner
    if (!phone) return null
    return {
      userId: String(row.user_id),
      phoneE164: phone,
      role: "owner",
      roleLabel: "OWNER",
    }
  } catch (e) {
    console.warn("[active-operator] owner lookup failed:", e)
    return null
  }
}

/**
 * Resolve the business account id for realtime channels.
 * Receptionists / techs map to their owning OWNER user id.
 */
export async function resolveWorkspaceAccountId(userId: string): Promise<string> {
  const id = userId.trim()
  if (!id) return id

  try {
    const roleRows = await sql()`
      SELECT lower(coalesce(account_role, 'owner')) AS role
      FROM users WHERE id = ${id} LIMIT 1
    `
    const role = String((roleRows[0] as { role?: string } | undefined)?.role || "owner")
    if (role === "owner") return id

    if (role === "receptionist") {
      const rows = await sql()`
        SELECT user_id::text AS owner_id
        FROM receptionists
        WHERE portal_user_id = ${id}
        LIMIT 1
      `
      const ownerId = (rows[0] as { owner_id?: string } | undefined)?.owner_id
      if (ownerId) return String(ownerId)
    }

    if (role === "field_tech" || role === "technician") {
      const rows = await sql()`
        SELECT user_id::text AS owner_id
        FROM field_technicians
        WHERE portal_user_id = ${id}
        LIMIT 1
      `
      const ownerId = (rows[0] as { owner_id?: string } | undefined)?.owner_id
      if (ownerId) return String(ownerId)
    }
  } catch (e) {
    console.warn("[active-operator] resolveWorkspaceAccountId failed:", e)
  }

  return id
}

/** Pusher / Ably-style account-wide presence channel name. */
export function workspacePresenceChannel(accountId: string): string {
  return `presence-account-${accountId.trim()}`
}
