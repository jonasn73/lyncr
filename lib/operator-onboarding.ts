// Platform-admin operator onboarding — invite tokens, provisioning steps, OTP, activation.

import bcrypt from "bcryptjs"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { RECEPTIONIST_INVITE_TTL_MS } from "@/lib/receptionist-invite-stub"
import type {
  OperatorAdminRow,
  OperatorAssignedWorkspace,
  OperatorOnboardingStatus,
} from "@/lib/types"

const DEFAULT_SIP_USERNAME = "admin9150"
const DEFAULT_PAYOUT_USD = 2.5
const OTP_TTL_MS = 10 * 60 * 1000

let cachedSql: ReturnType<typeof neon> | null = null
function getSql(): ReturnType<typeof neon> {
  if (cachedSql) return cachedSql
  cachedSql = neon(resolveNeonDatabaseUrl())
  return cachedSql
}

function isMissingOperatorColumn(e: unknown): boolean {
  const anyE = e as { code?: string; message?: string }
  const code = anyE?.code ?? ""
  const msg = String(anyE?.message ?? e ?? "")
  return code === "42703" || msg.includes("42703") || /column .* does not exist/i.test(msg)
}

const MIGRATION_HINT =
  "Operator onboarding needs migration 082 — run scripts/082-operator-onboarding.sql in Neon."

/** Placeholder email so phone-only SMS invites satisfy users.email UNIQUE. */
export function syntheticEmailForPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  return `${digits || "unknown"}@invite.lyncr.app`
}

export function isSyntheticInviteEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@invite.lyncr.app")
}

/** Human-readable contact for admin queue (prefer cell over synthetic email). */
export function formatOperatorContact(email: string, phone: string | null): string {
  const p = phone?.trim()
  if (p) {
    const d = p.replace(/\D/g, "")
    if (d.length === 11 && d.startsWith("1")) {
      return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
    }
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    return p
  }
  if (isSyntheticInviteEmail(email)) return "—"
  return email
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? ""
  const cleaned = local.replace(/[._-]+/g, " ").trim()
  if (!cleaned) return "Lyncr Operator"
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const raw = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)
  return (raw || "LO").toUpperCase()
}

function parseAssignedWorkspaces(raw: unknown): OperatorAssignedWorkspace[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const o = item as Record<string, unknown>
      const business_name = String(o.business_name ?? o.businessName ?? "").trim()
      if (!business_name) return null
      return {
        organization_id: o.organization_id != null ? String(o.organization_id) : null,
        business_name,
        line_e164: o.line_e164 != null ? String(o.line_e164) : null,
        industry_tag: o.industry_tag != null ? String(o.industry_tag) : null,
      } satisfies OperatorAssignedWorkspace
    })
    .filter(Boolean) as OperatorAssignedWorkspace[]
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export type OperatorInvitePreview = {
  userId: string
  email: string
  phone: string | null
  name: string
  timezone: string | null
  status: OperatorOnboardingStatus
  assignedWorkspaces: OperatorAssignedWorkspace[]
  /** True when the invite text already verified this cell — skip OTP on setup. */
  phoneVerifiedBySmsInvite: boolean
}

/** Create or refresh an operator invite stub (SMS-first — phone is required). */
export async function inviteOperatorStub(params: {
  phone: string
  name: string
  email?: string | null
  timezone?: string
  assignedWorkspaces?: OperatorAssignedWorkspace[]
}): Promise<{ userId: string; token: string; expiresAt: string; created: boolean; phone: string }> {
  const sql = getSql()
  const phone = normalizePhoneNumberE164(params.phone)
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("Enter a valid US cell phone number.")
  }
  const name = params.name.trim() || "Lyncr Operator"
  const timezone = (params.timezone ?? "America/New_York").trim() || "America/New_York"
  const email =
    params.email?.trim() && params.email.includes("@")
      ? params.email.trim().toLowerCase()
      : syntheticEmailForPhone(phone)
  const workspaces = JSON.stringify(parseAssignedWorkspaces(params.assignedWorkspaces ?? []))
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + RECEPTIONIST_INVITE_TTL_MS).toISOString()
  const phoneDigits = phone.replace(/\D/g, "")

  try {
    const existing = (await sql`
      SELECT id, invite_status, operator_onboarding_status, email
      FROM users
      WHERE lower(email) = ${email}
         OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${phoneDigits}
      LIMIT 1
    `) as Record<string, unknown>[]

    if (existing[0]) {
      const status = String(existing[0].invite_status ?? "").toLowerCase()
      const opStatus = String(existing[0].operator_onboarding_status ?? "")
      if (status === "active" || opStatus === "ACTIVE_READY") {
        throw new Error("An active operator account already exists for this phone number.")
      }
      const id = String(existing[0].id)
      await sql`
        UPDATE users
        SET name = ${name},
            email = ${email},
            phone = ${phone},
            invitation_token = ${token},
            invitation_expires_at = ${expiresAt}::timestamptz,
            invite_status = 'invited',
            account_role = 'receptionist',
            operator_onboarding_status = 'PENDING_INVITE',
            timezone = ${timezone},
            operator_assigned_workspaces = ${workspaces}::jsonb
        WHERE id = ${id}
      `
      return { userId: id, token, expiresAt, created: false, phone }
    }

    const id = crypto.randomUUID()
    await sql`
      INSERT INTO users (
        id, email, name, phone, business_name, industry, password_hash,
        account_role, invite_status, invitation_token, invitation_expires_at,
        operator_onboarding_status, timezone, operator_assigned_workspaces, created_at
      )
      VALUES (
        ${id}, ${email}, ${name}, ${phone}, 'Lyncr Operator', 'generic', '',
        'receptionist', 'invited', ${token}, ${expiresAt}::timestamptz,
        'PENDING_INVITE', ${timezone}, ${workspaces}::jsonb, now()
      )
    `
    return { userId: id, token, expiresAt, created: true, phone }
  } catch (e) {
    if (isMissingOperatorColumn(e)) throw new Error(MIGRATION_HINT)
    throw e
  }
}

/** Load invite preview for the onboarding wizard (valid token only). */
export async function getOperatorInviteByToken(token: string): Promise<OperatorInvitePreview | null> {
  const clean = token.trim()
  if (!clean) return null
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id, email, name, phone, timezone, operator_onboarding_status, operator_assigned_workspaces
      FROM users
      WHERE invitation_token = ${clean}
        AND coalesce(invite_status, '') = 'invited'
        AND (invitation_expires_at IS NULL OR invitation_expires_at > now())
      LIMIT 1
    `) as Record<string, unknown>[]
    const row = rows[0]
    if (!row) return null
    const status = String(row.operator_onboarding_status ?? "PENDING_INVITE") as OperatorOnboardingStatus
    const email = String(row.email)
    const phoneRaw = row.phone != null ? String(row.phone) : null
    const phone = phoneRaw?.trim() ? normalizePhoneNumberE164(phoneRaw) : null
    return {
      userId: String(row.id),
      email,
      phone,
      name: String(row.name ?? ""),
      timezone: row.timezone != null ? String(row.timezone) : null,
      status: status === "DEVICE_TESTING" || status === "ACTIVE_READY" ? status : "PENDING_INVITE",
      assignedWorkspaces: parseAssignedWorkspaces(row.operator_assigned_workspaces),
      phoneVerifiedBySmsInvite: Boolean(phone && isSyntheticInviteEmail(email)),
    }
  } catch (e) {
    if (isMissingOperatorColumn(e)) return null
    throw e
  }
}

async function getUserIdByToken(token: string): Promise<string | null> {
  const preview = await getOperatorInviteByToken(token)
  return preview?.userId ?? null
}

/** Step 1 complete — mic/WebRTC hardware check passed. */
export async function markOperatorDeviceTesting(token: string): Promise<boolean> {
  const userId = await getUserIdByToken(token)
  if (!userId) return false
  const sql = getSql()
  await sql`
    UPDATE users
    SET operator_onboarding_status = 'DEVICE_TESTING'
    WHERE id = ${userId}
      AND coalesce(invite_status, '') = 'invited'
  `
  return true
}

/** Send (or refresh) SMS OTP for backup phone binding. Returns dev code when ZING_OPERATOR_OTP_DEV=1. */
export async function sendOperatorOnboardingOtp(params: {
  token: string
  backupPhone: string
}): Promise<{ sent: boolean; devCode?: string; normalizedPhone: string }> {
  const userId = await getUserIdByToken(params.token)
  if (!userId) throw new Error("Invite link is invalid or expired.")
  const phone = normalizePhoneNumberE164(params.backupPhone)
  if (phone.replace(/\D/g, "").length < 10) throw new Error("Enter a valid mobile number.")

  const code = generateOtpCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString()
  const sql = getSql()
  await sql`
    UPDATE users
    SET onboarding_otp_code = ${code},
        onboarding_otp_expires_at = ${expiresAt}::timestamptz,
        phone = ${phone}
    WHERE id = ${userId}
  `

  const devMode = (process.env.ZING_OPERATOR_OTP_DEV || "").trim() === "1"
  if (devMode) {
    return { sent: true, devCode: code, normalizedPhone: phone }
  }

  try {
    const { sendTelnyxSms } = await import("@/lib/telnyx-sms")
    const result = await sendTelnyxSms({
      toE164: phone,
      text: `Your Lyncr operator verification code is ${code}. It expires in 10 minutes.`,
      userId,
    })
    if (!result.ok) throw new Error(result.error || "SMS delivery failed")
    return { sent: true, normalizedPhone: phone }
  } catch (e) {
    console.warn("[operator-onboarding] OTP SMS failed — falling back to dev log:", e)
    console.info("[operator-onboarding] OTP for", phone, ":", code)
    return { sent: true, devCode: code, normalizedPhone: phone }
  }
}

/** Verify OTP, set password, activate receptionist row, mark ACTIVE_READY. */
export async function verifyOperatorOtpAndActivate(params: {
  token: string
  code: string
  password: string
  name?: string
  preferWebRouting?: boolean
}): Promise<{ userId: string; email: string }> {
  const cleanToken = params.token.trim()
  const preview = await getOperatorInviteByToken(cleanToken)
  if (!preview) throw new Error("Invite link is invalid or expired.")

  const code = params.code.trim()
  if (code.length < 4) throw new Error("Enter the verification code from your text message.")
  if (params.password.length < 8) throw new Error("Password must be at least 8 characters.")

  const sql = getSql()
  const rows = (await sql`
    SELECT onboarding_otp_code, onboarding_otp_expires_at
    FROM users
    WHERE id = ${preview.userId}
      AND invitation_token = ${cleanToken}
      AND coalesce(invite_status, '') = 'invited'
    LIMIT 1
  `) as Record<string, unknown>[]
  const row = rows[0]
  if (!row) throw new Error("Invite link is invalid or expired.")

  const storedOtp = String(row.onboarding_otp_code ?? "")
  const otpExpires = row.onboarding_otp_expires_at ? new Date(String(row.onboarding_otp_expires_at)).getTime() : 0
  if (!storedOtp || storedOtp !== code || otpExpires < Date.now()) {
    throw new Error("Verification code is incorrect or expired.")
  }

  return finalizeOperatorActivation({
    preview,
    token: cleanToken,
    password: params.password,
    name: params.name,
    preferWebRouting: params.preferWebRouting,
  })
}

/** SMS invite link already verified the cell — password only, no OTP. */
export async function activateOperatorFromSmsInvite(params: {
  token: string
  password: string
  name?: string
  preferWebRouting?: boolean
}): Promise<{ userId: string; email: string }> {
  const cleanToken = params.token.trim()
  const preview = await getOperatorInviteByToken(cleanToken)
  if (!preview) throw new Error("Invite link is invalid or expired.")
  if (!preview.phoneVerifiedBySmsInvite || !preview.phone) {
    throw new Error("This invite requires phone verification.")
  }
  if (params.password.length < 8) throw new Error("Password must be at least 8 characters.")

  return finalizeOperatorActivation({
    preview,
    token: cleanToken,
    password: params.password,
    name: params.name,
    preferWebRouting: params.preferWebRouting,
  })
}

async function finalizeOperatorActivation(params: {
  preview: OperatorInvitePreview
  token: string
  password: string
  name?: string
  preferWebRouting?: boolean
}): Promise<{ userId: string; email: string }> {
  const sql = getSql()
  const name = (params.name ?? params.preview.name).trim() || params.preview.name
  const phone = normalizePhoneNumberE164(params.preview.phone ?? "")
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("A valid phone number is required.")
  }
  const backupPhone = phone
  const workspaces = params.preview.assignedWorkspaces
  const workspacesJson = JSON.stringify(workspaces)
  const passwordHash = await bcrypt.hash(params.password, 10)
  const receptionistId = crypto.randomUUID()
  const routingEndpoint = params.preferWebRouting ? "WEB" : "CELL"

  const existingRec = (await sql`
    SELECT id FROM receptionists WHERE portal_user_id = ${params.preview.userId} LIMIT 1
  `) as Record<string, unknown>[]

  const ops = [
    sql`
      UPDATE users
      SET name = ${name},
          phone = ${phone},
          password_hash = ${passwordHash},
          account_role = 'receptionist',
          invite_status = 'active',
          operator_onboarding_status = 'ACTIVE_READY',
          invitation_token = NULL,
          invitation_expires_at = NULL,
          onboarding_otp_code = NULL,
          onboarding_otp_expires_at = NULL
      WHERE id = ${params.preview.userId}
    `,
  ]

  if (!existingRec[0]) {
    ops.push(sql`
      INSERT INTO receptionists (
        id, user_id, name, phone, initials, color, rate_per_minute, pay_mode, flat_rate_usd,
        is_active, portal_user_id, sip_username, routing_endpoint, backup_phone_number,
        assigned_workspaces, created_at
      )
      VALUES (
        ${receptionistId}, ${params.preview.userId}, ${name}, ${phone}, ${initialsFor(name)}, 'bg-primary', 0.25,
        'FLAT_RATE', ${DEFAULT_PAYOUT_USD}, true, ${params.preview.userId}, ${DEFAULT_SIP_USERNAME},
        ${routingEndpoint}, ${backupPhone}, ${workspacesJson}::jsonb, now()
      )
    `)
  } else {
    ops.push(sql`
      UPDATE receptionists
      SET name = ${name},
          phone = ${phone},
          backup_phone_number = ${backupPhone},
          assigned_workspaces = ${workspacesJson}::jsonb,
          routing_endpoint = ${routingEndpoint},
          is_active = true
      WHERE portal_user_id = ${params.preview.userId}
    `)
  }

  await sql.transaction(ops)
  return { userId: params.preview.userId, email: params.preview.email }
}

/** List operator invite/provisioning rows for the platform admin console. */
export async function listOperatorOnboardingRows(): Promise<OperatorAdminRow[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id, email, name, phone, timezone, operator_onboarding_status, invitation_expires_at,
             operator_assigned_workspaces, created_at
      FROM users
      WHERE account_role = 'receptionist'
        AND (
          operator_onboarding_status IS NOT NULL
          OR coalesce(invite_status, '') IN ('invited', 'active')
        )
      ORDER BY created_at DESC
      LIMIT 200
    `) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: String(r.id),
      email: String(r.email),
      phone: r.phone != null && String(r.phone).trim() ? String(r.phone) : null,
      name: String(r.name ?? ""),
      timezone: r.timezone != null ? String(r.timezone) : null,
      operator_onboarding_status: (r.operator_onboarding_status != null
        ? String(r.operator_onboarding_status)
        : null) as OperatorOnboardingStatus | null,
      invitation_expires_at:
        r.invitation_expires_at != null ? String(r.invitation_expires_at) : null,
      assigned_workspaces: parseAssignedWorkspaces(r.operator_assigned_workspaces),
      created_at: String(r.created_at ?? ""),
    }))
  } catch (e) {
    if (isMissingOperatorColumn(e)) return []
    throw e
  }
}
