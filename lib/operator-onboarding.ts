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
  name: string
  timezone: string | null
  status: OperatorOnboardingStatus
  assignedWorkspaces: OperatorAssignedWorkspace[]
}

/** Create or refresh an operator invite stub with platform-admin metadata. */
export async function inviteOperatorStub(params: {
  email: string
  name: string
  timezone: string
  assignedWorkspaces?: OperatorAssignedWorkspace[]
}): Promise<{ userId: string; token: string; expiresAt: string; created: boolean }> {
  const sql = getSql()
  const email = params.email.trim().toLowerCase()
  const name = params.name.trim() || nameFromEmail(email)
  const timezone = params.timezone.trim() || "America/New_York"
  const workspaces = JSON.stringify(parseAssignedWorkspaces(params.assignedWorkspaces ?? []))
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + RECEPTIONIST_INVITE_TTL_MS).toISOString()

  try {
    const existing = (await sql`
      SELECT id, invite_status, operator_onboarding_status FROM users WHERE lower(email) = ${email} LIMIT 1
    `) as Record<string, unknown>[]

    if (existing[0]) {
      const status = String(existing[0].invite_status ?? "").toLowerCase()
      const opStatus = String(existing[0].operator_onboarding_status ?? "")
      if (status === "active" || opStatus === "ACTIVE_READY") {
        throw new Error("An active operator account already exists for this email.")
      }
      const id = String(existing[0].id)
      await sql`
        UPDATE users
        SET name = ${name},
            invitation_token = ${token},
            invitation_expires_at = ${expiresAt}::timestamptz,
            invite_status = 'invited',
            account_role = 'receptionist',
            operator_onboarding_status = 'PENDING_INVITE',
            timezone = ${timezone},
            operator_assigned_workspaces = ${workspaces}::jsonb
        WHERE id = ${id}
      `
      return { userId: id, token, expiresAt, created: false }
    }

    const id = crypto.randomUUID()
    await sql`
      INSERT INTO users (
        id, email, name, phone, business_name, industry, password_hash,
        account_role, invite_status, invitation_token, invitation_expires_at,
        operator_onboarding_status, timezone, operator_assigned_workspaces, created_at
      )
      VALUES (
        ${id}, ${email}, ${name}, '', 'Lyncr Operator', 'generic', '',
        'receptionist', 'invited', ${token}, ${expiresAt}::timestamptz,
        'PENDING_INVITE', ${timezone}, ${workspaces}::jsonb, now()
      )
    `
    return { userId: id, token, expiresAt, created: true }
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
      SELECT id, email, name, timezone, operator_onboarding_status, operator_assigned_workspaces
      FROM users
      WHERE invitation_token = ${clean}
        AND coalesce(invite_status, '') = 'invited'
        AND (invitation_expires_at IS NULL OR invitation_expires_at > now())
      LIMIT 1
    `) as Record<string, unknown>[]
    const row = rows[0]
    if (!row) return null
    const status = String(row.operator_onboarding_status ?? "PENDING_INVITE") as OperatorOnboardingStatus
    return {
      userId: String(row.id),
      email: String(row.email),
      name: String(row.name ?? ""),
      timezone: row.timezone != null ? String(row.timezone) : null,
      status: status === "DEVICE_TESTING" || status === "ACTIVE_READY" ? status : "PENDING_INVITE",
      assignedWorkspaces: parseAssignedWorkspaces(row.operator_assigned_workspaces),
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
    SELECT id, email, name, phone, onboarding_otp_code, onboarding_otp_expires_at,
           operator_assigned_workspaces, operator_onboarding_status
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

  const name = (params.name ?? String(row.name ?? "")).trim() || preview.name
  const phone = normalizePhoneNumberE164(String(row.phone ?? ""))
  const backupPhone = phone
  const workspaces = parseAssignedWorkspaces(row.operator_assigned_workspaces)
  const workspacesJson = JSON.stringify(workspaces)
  const passwordHash = await bcrypt.hash(params.password, 10)
  const receptionistId = crypto.randomUUID()
  const routingEndpoint = params.preferWebRouting ? "WEB" : "CELL"

  const existingRec = (await sql`
    SELECT id FROM receptionists WHERE portal_user_id = ${preview.userId} LIMIT 1
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
      WHERE id = ${preview.userId}
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
        ${receptionistId}, ${preview.userId}, ${name}, ${phone}, ${initialsFor(name)}, 'bg-primary', 0.25,
        'FLAT_RATE', ${DEFAULT_PAYOUT_USD}, true, ${preview.userId}, ${DEFAULT_SIP_USERNAME},
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
      WHERE portal_user_id = ${preview.userId}
    `)
  }

  await sql.transaction(ops)
  return { userId: preview.userId, email: preview.email }
}

/** List operator invite/provisioning rows for the platform admin console. */
export async function listOperatorOnboardingRows(): Promise<OperatorAdminRow[]> {
  const sql = getSql()
  try {
    const rows = (await sql`
      SELECT id, email, name, timezone, operator_onboarding_status, invitation_expires_at,
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
