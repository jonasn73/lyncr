// ============================================
// Receptionist invite stubs (native Neon SQL — no ORM)
// ============================================
// The email-invite flow creates a stub `users` row up front (account_role = 'receptionist',
// invite_status = 'invited') carrying a one-time onboarding token + expiry (migration 054):
//
//   admin "Invite receptionist" (EMAIL) → upsertReceptionistInviteStub
//     → Lyncr-branded /onboarding?token=… email
//     → /register?token=… validates via getReceptionistInviteStubByToken
//     → activateReceptionistInviteStub (sets password, links a receptionists row, status → 'active')
//
// "Resend" regenerates the token + expiry on the same stub (refreshReceptionistInviteStub).
//
// Every query is a parameterized neon tagged template. Reads degrade gracefully (return null) when
// migration 054 has not been applied yet, so callers can fall back to the legacy invitations table.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"

/** Invited receptionists have 48h to finish onboarding before the token expires. */
export const RECEPTIONIST_INVITE_TTL_MS = 48 * 60 * 60 * 1000
/** sip_username every invited receptionist is seeded with until their own credential is provisioned. */
const DEFAULT_SIP_USERNAME = "admin9150"
/** Default invite payout applied to the receptionist row on activation. */
const DEFAULT_PAYOUT_USD = 2.5

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

/** Postgres "column does not exist" — migration 054 not applied yet. */
function isMissingInviteColumn(e: unknown): boolean {
  const anyE = e as { code?: string; message?: string }
  const code = anyE?.code ?? ""
  const msg = String(anyE?.message ?? e ?? "")
  return code === "42703" || msg.includes("42703") || /column .* does not exist/i.test(msg)
}

const MIGRATION_HINT =
  "Receptionist invites need migration 054 — run scripts/054-receptionist-invite-stub.sql in Neon."

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? ""
  const cleaned = local.replace(/[._-]+/g, " ").trim()
  if (!cleaned) return "Lyncr Receptionist"
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const raw = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)
  return (raw || "LR").toUpperCase()
}

export type ReceptionistInviteStub = { userId: string; email: string }

/**
 * Insert (or refresh) the stub `users` row for an email invite. Returns the stub user id.
 *   - No existing row     → INSERT a stub (role receptionist, status invited, empty password).
 *   - Existing stub       → UPDATE its token + expiry (re-invite).
 *   - Existing real account → throw (never overwrite an owner / active receptionist).
 */
export async function upsertReceptionistInviteStub(params: {
  email: string
  token: string
  expiresAt: string
}): Promise<{ userId: string; created: boolean }> {
  const sql = getSql()
  const email = params.email.trim().toLowerCase()

  try {
    const existing = (await sql`
      SELECT id, invite_status FROM users WHERE lower(email) = ${email} LIMIT 1
    `) as Record<string, unknown>[]

    if (existing[0]) {
      const status = String(existing[0].invite_status ?? "").toLowerCase()
      if (status !== "invited") {
        throw new Error("An account with this email already exists.")
      }
      const id = String(existing[0].id)
      await sql`
        UPDATE users
        SET invitation_token = ${params.token},
            invitation_expires_at = ${params.expiresAt}::timestamptz,
            invite_status = 'invited',
            account_role = 'receptionist'
        WHERE id = ${id}
      `
      return { userId: id, created: false }
    }

    const id = crypto.randomUUID()
    await sql`
      INSERT INTO users (
        id, email, name, phone, business_name, industry, password_hash,
        account_role, invite_status, invitation_token, invitation_expires_at, created_at
      )
      VALUES (
        ${id}, ${email}, ${nameFromEmail(email)}, '', 'Lyncr Receptionist', 'generic', '',
        'receptionist', 'invited', ${params.token}, ${params.expiresAt}::timestamptz, now()
      )
    `
    return { userId: id, created: true }
  } catch (e) {
    if (isMissingInviteColumn(e)) throw new Error(MIGRATION_HINT)
    throw e
  }
}

/** Look up a still-valid invited stub by its onboarding token (null when missing/expired/migration-pending). */
export async function getReceptionistInviteStubByToken(token: string): Promise<ReceptionistInviteStub | null> {
  const clean = token.trim()
  if (!clean) return null
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id, email
      FROM users
      WHERE invitation_token = ${clean}
        AND coalesce(invite_status, '') = 'invited'
        AND (invitation_expires_at IS NULL OR invitation_expires_at > now())
      LIMIT 1
    `) as Record<string, unknown>[]
    return rows[0] ? { userId: String(rows[0].id), email: String(rows[0].email) } : null
  } catch (e) {
    if (isMissingInviteColumn(e)) return null
    throw e
  }
}

/**
 * Resend: mint a fresh token + expiry on an existing invited stub (looked up by email).
 * Returns the new token, or null when there is no pending invite for that email.
 */
export async function refreshReceptionistInviteStub(params: {
  email: string
}): Promise<{ userId: string; email: string; token: string; expiresAt: string } | null> {
  const email = params.email.trim().toLowerCase()
  if (!email.includes("@")) return null
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + RECEPTIONIST_INVITE_TTL_MS).toISOString()
  const sql = getSql()
  try {
    const rows = (await sql`
      UPDATE users
      SET invitation_token = ${token},
          invitation_expires_at = ${expiresAt}::timestamptz,
          invite_status = 'invited',
          account_role = 'receptionist'
      WHERE lower(email) = ${email}
        AND coalesce(invite_status, '') = 'invited'
      RETURNING id
    `) as Record<string, unknown>[]
    return rows[0] ? { userId: String(rows[0].id), email, token, expiresAt } : null
  } catch (e) {
    if (isMissingInviteColumn(e)) return null
    throw e
  }
}

/**
 * Activate an invited stub once the receptionist completes the onboarding form. In one atomic
 * transaction: set their password/name/phone + flip the row to active (clearing the token), and
 * link a receptionists row (skipped if one already exists). Returns null when the token does not
 * match a pending stub so the caller can fall back to the legacy invitations flow.
 */
export async function activateReceptionistInviteStub(params: {
  token: string
  name: string
  phone: string
  passwordHash: string
}): Promise<ReceptionistInviteStub | null> {
  const stub = await getReceptionistInviteStubByToken(params.token)
  if (!stub) return null

  const name = params.name.trim()
  if (name.length < 2) throw new Error("Full name is required")
  const phone = normalizePhoneNumberE164(params.phone)
  const initials = initialsFor(name)
  const receptionistId = crypto.randomUUID()
  const sql = getSql()

  // Only create the receptionists row if the activation hasn't already linked one.
  const existingRec = (await sql`
    SELECT id FROM receptionists WHERE portal_user_id = ${stub.userId} LIMIT 1
  `) as Record<string, unknown>[]

  const ops = [
    sql`
      UPDATE users
      SET name = ${name},
          phone = ${phone},
          password_hash = ${params.passwordHash},
          account_role = 'receptionist',
          invite_status = 'active',
          invitation_token = NULL,
          invitation_expires_at = NULL
      WHERE id = ${stub.userId}
    `,
  ]
  if (!existingRec[0]) {
    ops.push(sql`
      INSERT INTO receptionists (
        id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd,
        is_active, portal_user_id, sip_username, created_at
      )
      VALUES (
        ${receptionistId}, ${stub.userId}, ${name}, ${phone}, ${initials}, 'bg-primary', 0.25, 'FLAT_RATE',
        ${DEFAULT_PAYOUT_USD}, true, ${stub.userId}, ${DEFAULT_SIP_USERNAME}, now()
      )
    `)
  }

  await sql.transaction(ops)
  return stub
}
