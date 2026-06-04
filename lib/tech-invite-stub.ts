// ============================================
// Field-technician invite stubs (native Neon SQL — no ORM)
// ============================================
// Mirrors the receptionist invite-stub flow, but techs are invited by MOBILE NUMBER (no email):
//
//   owner "Add field technician" (first, last, mobile) → createTechInviteStub
//     → stub users row (account_role = 'field_tech', invite_status = 'invited', password '')
//        + a field_technicians roster row, both carrying a one-time token + 48h expiry
//     → Lyncr-branded SMS with /tech/setup?token=… link
//     → /tech/setup validates via getTechInviteStubByToken
//     → activateTechInviteStub (sets password, status → 'active', clears token, activates roster)
//
// Reuses the users.invitation_token / invitation_expires_at / invite_status columns (scripts/054 + 064).
// All queries are parameterized neon templates.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { toE164 } from "@/lib/phone-e164"
import { syntheticTechEmail } from "@/lib/tech-invite"

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

/**
 * Detect a missing column (42703) or missing table (42P01) and return a precise,
 * actionable message that names the actual gap — instead of always blaming "064".
 * Returns null for any other error (so real failures aren't masked).
 */
function schemaGapMessage(e: unknown): string | null {
  const anyE = e as { code?: string; message?: string }
  const code = anyE?.code ?? ""
  const msg = String(anyE?.message ?? e ?? "")

  const missingColumn = code === "42703" || msg.includes("42703") || /column .* does not exist/i.test(msg)
  if (missingColumn) {
    const col = msg.match(/column "?([\w.]+)"? .*does not exist/i)?.[1] ?? "unknown"
    return `Field-tech invites can't run — the database is missing column "${col}". Run the latest migrations (011, 061, 064) in Neon → SQL Editor.`
  }

  const missingTable = code === "42P01" || msg.includes("42P01") || /relation .* does not exist/i.test(msg)
  if (missingTable) {
    const tbl = msg.match(/relation "?([\w.]+)"? does not exist/i)?.[1] ?? "field_technicians"
    return `Field-tech invites can't run — the database is missing table "${tbl}". Run migration 061 (and 064) in Neon → SQL Editor.`
  }

  return null
}

/** Back-compat: still used to gate read paths that should degrade quietly. */
function isMissingInviteColumn(e: unknown): boolean {
  return schemaGapMessage(e) !== null
}

export type TechInviteStub = {
  userId: string
  name: string
  phone: string
  businessName: string
}

/**
 * Create (or re-invite) the stub users row + roster row for a phone-only field-tech invite.
 *   - No existing login for that mobile → INSERT a stub + field_technicians row.
 *   - Existing INVITED stub for that mobile → refresh its token/expiry/name (re-invite).
 *   - Existing ACTIVE account for that mobile → throw (never overwrite a real login).
 */
export async function createTechInviteStub(params: {
  ownerUserId: string
  ownerBusinessName: string
  name: string
  phone: string
  token: string
  expiresAt: string
}): Promise<{ userId: string; created: boolean }> {
  const sql = getSql()
  const email = syntheticTechEmail(params.phone)
  const phoneE164 = toE164(params.phone)
  const businessName = params.ownerBusinessName?.trim() || "Lyncr"

  try {
    const existing = (await sql`
      SELECT id, invite_status FROM users WHERE lower(email) = ${email} LIMIT 1
    `) as Record<string, unknown>[]

    if (existing[0]) {
      const status = String(existing[0].invite_status ?? "").toLowerCase()
      if (status !== "invited") {
        throw new Error("That mobile number already has a Lyncr technician login.")
      }
      const id = String(existing[0].id)
      await sql`
        UPDATE users
        SET invitation_token = ${params.token},
            invitation_expires_at = ${params.expiresAt}::timestamptz,
            invite_status = 'invited',
            account_role = 'field_tech',
            name = ${params.name},
            phone = ${phoneE164}
        WHERE id = ${id}
      `
      // Keep the roster row in sync (it may already exist from the first invite).
      const roster = (await sql`
        SELECT id FROM field_technicians WHERE portal_user_id = ${id} LIMIT 1
      `) as Record<string, unknown>[]
      if (roster[0]) {
        await sql`UPDATE field_technicians SET name = ${params.name}, phone = ${phoneE164} WHERE portal_user_id = ${id}`
      } else {
        await sql`
          INSERT INTO field_technicians (id, user_id, portal_user_id, name, phone, is_active, created_at)
          VALUES (${crypto.randomUUID()}, ${params.ownerUserId}, ${id}, ${params.name}, ${phoneE164}, true, now())
        `
      }
      return { userId: id, created: false }
    }

    const id = crypto.randomUUID()
    await sql.transaction([
      // `industry` is intentionally omitted — it carries a NOT NULL DEFAULT 'generic'
      // in the schema, so we let the DB fill it and avoid coupling to migration 011.
      sql`
        INSERT INTO users (
          id, email, name, phone, business_name, password_hash,
          account_role, invite_status, invitation_token, invitation_expires_at, created_at
        )
        VALUES (
          ${id}, ${email}, ${params.name}, ${phoneE164}, ${businessName}, '',
          'field_tech', 'invited', ${params.token}, ${params.expiresAt}::timestamptz, now()
        )
      `,
      sql`
        INSERT INTO field_technicians (id, user_id, portal_user_id, name, phone, is_active, created_at)
        VALUES (${crypto.randomUUID()}, ${params.ownerUserId}, ${id}, ${params.name}, ${phoneE164}, true, now())
      `,
    ])
    return { userId: id, created: true }
  } catch (e) {
    const gap = schemaGapMessage(e)
    if (gap) throw new Error(gap)
    throw e
  }
}

/** Look up a still-valid invited tech stub by its setup token (null when missing/expired). */
export async function getTechInviteStubByToken(token: string): Promise<TechInviteStub | null> {
  const clean = token.trim()
  if (!clean) return null
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id, name, phone, business_name
      FROM users
      WHERE invitation_token = ${clean}
        AND coalesce(invite_status, '') = 'invited'
        AND account_role = 'field_tech'
        AND (invitation_expires_at IS NULL OR invitation_expires_at > now())
      LIMIT 1
    `) as Record<string, unknown>[]
    return rows[0]
      ? {
          userId: String(rows[0].id),
          name: rows[0].name != null ? String(rows[0].name) : "Technician",
          phone: rows[0].phone != null ? String(rows[0].phone) : "",
          businessName: rows[0].business_name != null ? String(rows[0].business_name) : "Lyncr",
        }
      : null
  } catch (e) {
    if (isMissingInviteColumn(e)) return null
    throw e
  }
}

/**
 * Activate an invited tech once they set their password: write the hash, flip the row to active,
 * clear the token (deactivating the link), and activate their roster entry. Returns the stub (incl.
 * userId for the session cookie), or null when the token is invalid/expired.
 */
export async function activateTechInviteStub(params: {
  token: string
  passwordHash: string
}): Promise<TechInviteStub | null> {
  const stub = await getTechInviteStubByToken(params.token)
  if (!stub) return null
  const sql = getSql()
  await sql.transaction([
    sql`
      UPDATE users
      SET password_hash = ${params.passwordHash},
          account_role = 'field_tech',
          invite_status = 'active',
          invitation_token = NULL,
          invitation_expires_at = NULL
      WHERE id = ${stub.userId}
    `,
    sql`UPDATE field_technicians SET is_active = true WHERE portal_user_id = ${stub.userId}`,
  ])
  return stub
}

/**
 * Resend: mint a fresh token + expiry on an existing invited tech stub (by their roster's portal id).
 * Returns the new token + contact info, or null when there is no pending invite for that tech.
 */
export async function refreshTechInviteStub(params: {
  portalUserId: string
  token: string
  expiresAt: string
}): Promise<TechInviteStub | null> {
  const sql = getSql()
  try {
    const rows = (await sql`
      UPDATE users
      SET invitation_token = ${params.token},
          invitation_expires_at = ${params.expiresAt}::timestamptz,
          invite_status = 'invited',
          account_role = 'field_tech'
      WHERE id = ${params.portalUserId}
        AND coalesce(invite_status, '') = 'invited'
      RETURNING id, name, phone, business_name
    `) as Record<string, unknown>[]
    return rows[0]
      ? {
          userId: String(rows[0].id),
          name: rows[0].name != null ? String(rows[0].name) : "Technician",
          phone: rows[0].phone != null ? String(rows[0].phone) : "",
          businessName: rows[0].business_name != null ? String(rows[0].business_name) : "Lyncr",
        }
      : null
  } catch (e) {
    if (isMissingInviteColumn(e)) return null
    throw e
  }
}
