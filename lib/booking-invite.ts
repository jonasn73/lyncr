// Opaque booking invite tokens for https://lyncr.app/book/[id] SMS links.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { toE164 } from "@/lib/phone-e164"
import { getAppUrl } from "@/lib/telnyx"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

export type BookingInvite = {
  id: string
  ownerUserId: string
  businessLine: string
  callerPhone: string | null
  source: string
}

/** Create a tracking invite and return the public /book/[id] URL. */
export async function createBookingInvite(params: {
  ownerUserId: string
  businessLine: string
  callerPhone?: string | null
  source?: string
}): Promise<{ invite: BookingInvite; url: string } | null> {
  const line =
    normalizePhoneNumberE164(params.businessLine) || toE164(params.businessLine)
  if (!line || !params.ownerUserId.trim()) return null

  const callerRaw = params.callerPhone?.trim() || ""
  const caller = callerRaw
    ? normalizePhoneNumberE164(callerRaw) || toE164(callerRaw) || null
    : null
  const source = (params.source || "ivr").trim() || "ivr"

  try {
    const sql = sqlClient()
    const rows = await sql`
      INSERT INTO booking_invites (owner_user_id, business_line, caller_phone, source)
      VALUES (${params.ownerUserId}, ${line}, ${caller}, ${source})
      RETURNING id, owner_user_id, business_line, caller_phone, source
    `
    const row = rows[0] as
      | {
          id: string
          owner_user_id: string
          business_line: string
          caller_phone: string | null
          source: string
        }
      | undefined
    if (!row?.id) return null

    const invite: BookingInvite = {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id),
      businessLine: String(row.business_line),
      callerPhone: row.caller_phone ? String(row.caller_phone) : null,
      source: String(row.source || source),
    }
    const base = getAppUrl().replace(/\/+$/, "") || "https://lyncr.app"
    return { invite, url: `${base}/book/${invite.id}` }
  } catch (e) {
    console.warn("[booking-invite] create failed — run scripts/091-booking-invites.sql:", e)
    return null
  }
}

/** Resolve a public /book/[id] token (ignores expired rows). */
export async function getBookingInviteById(id: string): Promise<BookingInvite | null> {
  const token = id.trim()
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null

  try {
    const sql = sqlClient()
    const rows = await sql`
      SELECT id, owner_user_id, business_line, caller_phone, source
      FROM booking_invites
      WHERE id = ${token}::uuid
        AND expires_at > now()
      LIMIT 1
    `
    const row = rows[0] as
      | {
          id: string
          owner_user_id: string
          business_line: string
          caller_phone: string | null
          source: string
        }
      | undefined
    if (!row) return null
    return {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id),
      businessLine: String(row.business_line),
      callerPhone: row.caller_phone ? String(row.caller_phone) : null,
      source: String(row.source || "ivr"),
    }
  } catch (e) {
    console.warn("[booking-invite] lookup failed:", e)
    return null
  }
}

/** Query-string fallback when invite table is missing. */
export function buildBookQueryUrl(opts: {
  callerPhone?: string | null
  businessLine: string
  bookBaseUrl?: string
}): string {
  const base = (opts.bookBaseUrl || "https://lyncr.app/book").replace(/\/+$/, "")
  const phone = opts.callerPhone?.trim()
    ? encodeURIComponent(
        normalizePhoneNumberE164(opts.callerPhone) || toE164(opts.callerPhone) || opts.callerPhone
      )
    : ""
  const line = encodeURIComponent(
    normalizePhoneNumberE164(opts.businessLine) || toE164(opts.businessLine) || opts.businessLine
  )
  const phoneQs = phone ? `phone=${phone}&` : ""
  return `${base}?${phoneQs}line=${line}`
}
