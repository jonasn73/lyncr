// Activity "Send book link" — create invites, public form URLs, fee helpers.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { toE164 } from "@/lib/phone-e164"
import { getAppUrl } from "@/lib/telnyx"
import {
  SERVICE_CALL_FEE_CENTS,
  SERVICE_CALL_FEE_DOLLARS,
} from "@/lib/service-call-fee"

function sqlClient() {
  // Neon serverless SQL tagged-template client
  return neon(resolveNeonDatabaseUrl())
}

/** Fee choices the owner picks in the Activity sheet. */
export type IntakeBookFeeMode = "none" | "service_call" | "full_quote"

export type IntakeBookLink = {
  id: string
  ownerUserId: string
  callerPhone: string
  businessLine: string | null
  callLogId: string | null
  feeMode: IntakeBookFeeMode
  quoteCents: number
  operatorNote: string
  payToken: string | null
  jobId: string | null
  submittedAt: string | null
  expiresAt: string
}

function parseFeeMode(raw: unknown): IntakeBookFeeMode {
  // Normalize DB / API strings into the three allowed modes
  const v = String(raw ?? "none").trim().toLowerCase()
  if (v === "service_call") return "service_call"
  if (v === "full_quote") return "full_quote"
  return "none"
}

function mapRow(row: Record<string, unknown>): IntakeBookLink {
  // Convert a Neon row into a typed invite object
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    callerPhone: String(row.caller_phone ?? ""),
    businessLine: row.business_line != null ? String(row.business_line) : null,
    callLogId: row.call_log_id != null ? String(row.call_log_id) : null,
    feeMode: parseFeeMode(row.fee_mode),
    quoteCents: Number(row.quote_cents) || 0,
    operatorNote: String(row.operator_note ?? ""),
    payToken: row.pay_token != null ? String(row.pay_token) : null,
    jobId: row.job_id != null ? String(row.job_id) : null,
    submittedAt:
      row.submitted_at instanceof Date
        ? row.submitted_at.toISOString()
        : row.submitted_at != null
          ? String(row.submitted_at)
          : null,
    expiresAt:
      row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : String(row.expires_at ?? ""),
  }
}

/** Resolve charge cents for the owner's fee choice. */
export function resolveIntakeBookQuoteCents(
  feeMode: IntakeBookFeeMode,
  quoteDollarsInput?: number | null
): number {
  if (feeMode === "none") return 0
  if (feeMode === "service_call") return SERVICE_CALL_FEE_CENTS
  const dollars = Number(quoteDollarsInput)
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error("Enter a quote amount greater than $0")
  }
  // Stripe minimum is $0.50 — keep full-quote practical for locksmith jobs
  const cents = Math.round(dollars * 100)
  if (cents < 50) throw new Error("Quote must be at least $0.50")
  if (cents > 50_000_00) throw new Error("Quote is too large")
  return cents
}

/** Human label for SMS + customer form heading. */
export function intakeBookFeeLabel(feeMode: IntakeBookFeeMode, quoteCents: number): string {
  if (feeMode === "none") return "Booking form (no fee)"
  if (feeMode === "service_call") return `Service call ($${SERVICE_CALL_FEE_DOLLARS})`
  const dollars = (Math.max(0, quoteCents) / 100).toFixed(quoteCents % 100 === 0 ? 0 : 2)
  return `Quote ($${dollars})`
}

/** Public customer URL for this invite. */
export function buildIntakeBookFormUrl(appUrl: string, inviteId: string): string {
  const base = appUrl.replace(/\/$/, "")
  return `${base}/book/form/${encodeURIComponent(inviteId)}`
}

/** Insert a new Activity book-link invite and return it + public URL. */
export async function createIntakeBookLink(params: {
  ownerUserId: string
  callerPhone: string
  businessLine?: string | null
  callLogId?: string | null
  feeMode: IntakeBookFeeMode
  quoteCents: number
  operatorNote?: string | null
  payToken?: string | null
}): Promise<{ link: IntakeBookLink; url: string } | null> {
  const phone =
    normalizePhoneNumberE164(params.callerPhone) || toE164(params.callerPhone)
  if (!phone || !params.ownerUserId.trim()) return null

  const lineRaw = params.businessLine?.trim() || ""
  const line = lineRaw
    ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) || lineRaw
    : null
  const note = String(params.operatorNote ?? "").trim().slice(0, 280)
  const feeMode = parseFeeMode(params.feeMode)
  const quoteCents = feeMode === "none" ? 0 : Math.max(0, Math.round(params.quoteCents))

  try {
    const sql = sqlClient()
    const rows = await sql`
      INSERT INTO intake_book_links (
        owner_user_id, caller_phone, business_line, call_log_id,
        fee_mode, quote_cents, operator_note, pay_token
      )
      VALUES (
        ${params.ownerUserId},
        ${phone},
        ${line},
        ${params.callLogId?.trim() || null},
        ${feeMode},
        ${quoteCents},
        ${note},
        ${params.payToken?.trim() || null}
      )
      RETURNING *
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row?.id) return null
    const link = mapRow(row)
    const url = buildIntakeBookFormUrl(getAppUrl(), link.id)
    return { link, url }
  } catch (e) {
    console.warn(
      "[intake-book-link] create failed — run scripts/125-intake-book-links.sql:",
      e
    )
    return null
  }
}

/** Load a non-expired invite by UUID. */
export async function getIntakeBookLinkById(id: string): Promise<IntakeBookLink | null> {
  const token = id.trim()
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null
  try {
    const sql = sqlClient()
    const rows = await sql`
      SELECT *
      FROM intake_book_links
      WHERE id = ${token}::uuid
        AND expires_at > now()
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return mapRow(row)
  } catch (e) {
    console.warn("[intake-book-link] lookup failed:", e)
    return null
  }
}

/** Mark invite submitted and attach the created/updated lead id. */
export async function markIntakeBookLinkSubmitted(params: {
  id: string
  jobId: string
}): Promise<boolean> {
  const id = params.id.trim()
  const jobId = params.jobId.trim()
  if (!id || !jobId) return false
  try {
    const sql = sqlClient()
    const rows = await sql`
      UPDATE intake_book_links
      SET
        job_id = ${jobId},
        submitted_at = coalesce(submitted_at, now())
      WHERE id = ${id}::uuid
      RETURNING id
    `
    return rows.length > 0
  } catch (e) {
    console.warn("[intake-book-link] mark submitted failed:", e)
    return false
  }
}

/** Map form job-kind chips → intake jobType string. */
export function jobTypeFromBookFormKind(jobKind: string): string {
  const k = jobKind.trim().toLowerCase()
  if (k === "copy") return "Key replacement (Duplication)"
  if (k === "akl") return "Key replacement (Origination)"
  if (k === "lockout") return "Lockout"
  if (k === "other") return "Service call"
  return "Service call"
}

/** SMS body for the Activity book link. */
export function buildIntakeBookLinkSms(params: {
  businessLabel: string
  url: string
  feeMode: IntakeBookFeeMode
  quoteCents: number
  operatorNote?: string | null
}): string {
  const business = params.businessLabel.trim() || "Your locksmith"
  const fee = intakeBookFeeLabel(params.feeMode, params.quoteCents)
  const note = params.operatorNote?.trim()
  const lines = [
    `${business} sent you a short form to finish booking.`,
    params.feeMode === "none" ? "No payment required — just your details." : `Then pay: ${fee}.`,
    "",
    params.url,
  ]
  if (note) {
    lines.push("", note)
  }
  return lines.join("\n")
}
