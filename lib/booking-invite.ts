// Opaque booking invite tokens for https://lyncr.app/book/[id] and /b/[short] SMS links.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164 } from "@/lib/db"
import { toE164 } from "@/lib/phone-e164"
import { getAppUrl } from "@/lib/telnyx"
import type { BookingIntakePrefill } from "@/lib/book-customer-request"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

export type BookingInvite = {
  id: string
  ownerUserId: string
  businessLine: string
  callerPhone: string | null
  source: string
  /** Short public token when migration 131 is applied. */
  shortCode?: string | null
  /** Hold-intake answers for /book form pre-fill when migration 176 is applied. */
  prefill?: BookingIntakePrefill | null
}

/** Parse a prefill jsonb value into the typed shape (null for anything unusable). */
function parseInvitePrefill(value: unknown): BookingIntakePrefill | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null)
  const intentSlug = str(v.intent_slug)
  const intentLabel = str(v.intent_label)
  const vehicleYear = str(v.vehicle_year)
  const vehicleMake = str(v.vehicle_make)
  const vehicleModel = str(v.vehicle_model)
  if (!intentSlug && !intentLabel && !vehicleYear && !vehicleMake && !vehicleModel) return null
  return {
    ...(intentSlug ? { intent_slug: intentSlug } : {}),
    ...(intentLabel ? { intent_label: intentLabel } : {}),
    ...(vehicleYear ? { vehicle_year: vehicleYear } : {}),
    ...(vehicleMake ? { vehicle_make: vehicleMake } : {}),
    ...(vehicleModel ? { vehicle_model: vehicleModel } : {}),
  }
}

/** Alphabet for short codes — no ambiguous 0/O/1/I. */
const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

/** Generate an 8-char public short code. */
function generateBookingInviteShortCode(length = 8): string {
  let out = ""
  for (let i = 0; i < length; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)]
  }
  return out
}

function appBaseUrl(): string {
  return getAppUrl().replace(/\/+$/, "") || "https://lyncr.app"
}

/** Prefer short /b/XXXX links; fall back to UUID /book/[id]. */
function publicBookingInviteUrl(invite: {
  id: string
  shortCode?: string | null
}): string {
  const base = appBaseUrl()
  const code = invite.shortCode?.trim()
  if (code) return `${base}/b/${code}`
  return `${base}/book/${invite.id}`
}

function last10Digits(phone: string | null | undefined): string {
  return String(phone || "")
    .replace(/\D/g, "")
    .slice(-10)
}

/**
 * Reuse an open invite for the same caller (same day / cooldown window)
 * so SMS does not mint a new UUID every time.
 */
async function findReusableBookingInvite(params: {
  ownerUserId: string
  callerPhone: string
  /** Hours to look back (default 24 ≈ same calendar day for most shops). */
  withinHours?: number
}): Promise<BookingInvite | null> {
  const owner = params.ownerUserId.trim()
  const caller =
    normalizePhoneNumberE164(params.callerPhone) || toE164(params.callerPhone)
  if (!owner || !caller) return null
  const digits = last10Digits(caller)
  if (digits.length < 10) return null
  const hours = params.withinHours ?? 24

  try {
    const sql = sqlClient()
    const rows = await sql`
      SELECT id, owner_user_id, business_line, caller_phone, source, short_code, prefill
      FROM booking_invites
      WHERE owner_user_id = ${owner}::uuid
        AND expires_at > now()
        AND created_at > now() - (${hours}::text || ' hours')::interval
        AND (
          caller_phone = ${caller}
          OR RIGHT(regexp_replace(COALESCE(caller_phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
        )
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0] as
      | {
          id: string
          owner_user_id: string
          business_line: string
          caller_phone: string | null
          source: string
          short_code?: string | null
          prefill?: unknown
        }
      | undefined
    if (!row?.id) return null
    return {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id),
      businessLine: String(row.business_line),
      callerPhone: row.caller_phone ? String(row.caller_phone) : null,
      source: String(row.source || "ivr"),
      shortCode: row.short_code ? String(row.short_code) : null,
      prefill: parseInvitePrefill(row.prefill),
    }
  } catch (e) {
    // prefill / short_code columns may be missing pre-migration — retry without them.
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("prefill") || msg.includes("short_code")) {
      try {
        const sql = sqlClient()
        const rows = await sql`
          SELECT id, owner_user_id, business_line, caller_phone, source
          FROM booking_invites
          WHERE owner_user_id = ${owner}::uuid
            AND expires_at > now()
            AND created_at > now() - (${hours}::text || ' hours')::interval
            AND (
              caller_phone = ${caller}
              OR RIGHT(regexp_replace(COALESCE(caller_phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
            )
          ORDER BY created_at DESC
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
        if (!row?.id) return null
        return {
          id: String(row.id),
          ownerUserId: String(row.owner_user_id),
          businessLine: String(row.business_line),
          callerPhone: row.caller_phone ? String(row.caller_phone) : null,
          source: String(row.source || "ivr"),
          shortCode: null,
        }
      } catch (e2) {
        console.warn("[booking-invite] reusable lookup failed:", e2)
        return null
      }
    }
    console.warn("[booking-invite] reusable lookup failed:", e)
    return null
  }
}

/** Create (or reuse) a tracking invite and return the public SMS URL. */
export async function createBookingInvite(params: {
  ownerUserId: string
  businessLine: string
  callerPhone?: string | null
  source?: string
  /** When false, always insert a new row (operator forced re-send). Default true. */
  reuseOpen?: boolean
  /** Hold-intake answers so /book pre-fills what the caller already said (migration 176). */
  prefill?: BookingIntakePrefill | null
}): Promise<{ invite: BookingInvite; url: string; reused: boolean } | null> {
  const line =
    normalizePhoneNumberE164(params.businessLine) || toE164(params.businessLine)
  if (!line || !params.ownerUserId.trim()) return null

  const callerRaw = params.callerPhone?.trim() || ""
  const caller = callerRaw
    ? normalizePhoneNumberE164(callerRaw) || toE164(callerRaw) || null
    : null
  const source = (params.source || "ivr").trim() || "ivr"
  const reuseOpen = params.reuseOpen !== false
  const prefill = params.prefill ?? null

  if (reuseOpen && caller) {
    const existing = await findReusableBookingInvite({
      ownerUserId: params.ownerUserId,
      callerPhone: caller,
      withinHours: 24,
    })
    if (existing) {
      // Newer intake answers enrich the reused link — merged over what it already had
      // so a re-send after the caller answered more questions still pre-fills.
      const mergedPrefill = prefill
        ? { ...(existing.prefill || {}), ...prefill }
        : existing.prefill ?? null
      if (prefill) {
        try {
          const sql = sqlClient()
          await sql`
            UPDATE booking_invites
            SET prefill = ${JSON.stringify(mergedPrefill)}::jsonb
            WHERE id = ${existing.id}::uuid
          `
        } catch (e) {
          console.warn("[booking-invite] prefill update skipped:", e)
        }
      }
      const invite = { ...existing, prefill: mergedPrefill }
      return { invite, url: publicBookingInviteUrl(invite), reused: true }
    }
  }

  const prefillJson = prefill ? JSON.stringify(prefill) : null

  // Try a few short codes in case of rare unique collisions.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortCode = generateBookingInviteShortCode(8)
    try {
      const sql = sqlClient()
      const rows = await sql`
        INSERT INTO booking_invites (owner_user_id, business_line, caller_phone, source, short_code, prefill)
        VALUES (${params.ownerUserId}, ${line}, ${caller}, ${source}, ${shortCode}, ${prefillJson}::jsonb)
        RETURNING id, owner_user_id, business_line, caller_phone, source, short_code, prefill
      `
      const row = rows[0] as
        | {
            id: string
            owner_user_id: string
            business_line: string
            caller_phone: string | null
            source: string
            short_code?: string | null
            prefill?: unknown
          }
        | undefined
      if (!row?.id) return null

      const invite: BookingInvite = {
        id: String(row.id),
        ownerUserId: String(row.owner_user_id),
        businessLine: String(row.business_line),
        callerPhone: row.caller_phone ? String(row.caller_phone) : null,
        source: String(row.source || source),
        shortCode: row.short_code ? String(row.short_code) : shortCode,
        prefill: parseInvitePrefill(row.prefill),
      }
      return { invite, url: publicBookingInviteUrl(invite), reused: false }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Unique violation on short_code — retry with a new code. Checked BEFORE the
      // missing-column fallback: the constraint name also contains "short_code".
      if (msg.includes("duplicate key") || msg.includes("unique constraint")) {
        continue
      }
      // Pre-migration: prefill and/or short_code column missing — insert without them.
      // A prefill-only miss (migration 131 applied, 176 not yet) keeps its short /b link.
      if (msg.includes("does not exist") && (msg.includes("prefill") || msg.includes("short_code"))) {
        const keepShortCode = !msg.includes("short_code")
        try {
          const sql = sqlClient()
          const rows = keepShortCode
            ? await sql`
                INSERT INTO booking_invites (owner_user_id, business_line, caller_phone, source, short_code)
                VALUES (${params.ownerUserId}, ${line}, ${caller}, ${source}, ${shortCode})
                RETURNING id, owner_user_id, business_line, caller_phone, source, short_code
              `
            : await sql`
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
                short_code?: string | null
              }
            | undefined
          if (!row?.id) return null
          const invite: BookingInvite = {
            id: String(row.id),
            ownerUserId: String(row.owner_user_id),
            businessLine: String(row.business_line),
            callerPhone: row.caller_phone ? String(row.caller_phone) : null,
            source: String(row.source || source),
            shortCode: row.short_code ? String(row.short_code) : null,
          }
          return { invite, url: publicBookingInviteUrl(invite), reused: false }
        } catch (e2) {
          console.warn("[booking-invite] create failed — run scripts/091-booking-invites.sql:", e2)
          return null
        }
      }
      // Unique violation on short_code — retry with a new code.
      if (msg.includes("booking_invites_short_code") || msg.includes("unique")) {
        continue
      }
      console.warn("[booking-invite] create failed — run scripts/091-booking-invites.sql:", e)
      return null
    }
  }
  console.warn("[booking-invite] create failed after short_code retries")
  return null
}

/** True when token looks like a UUID. */
function isUuidToken(token: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(token)
}

/** True when token looks like a short booking code. */
function isShortCodeToken(token: string): boolean {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,12}$/i.test(token)
}

/** Resolve a public /book/[id] or /b/[code] token (ignores expired rows). */
export async function getBookingInviteById(id: string): Promise<BookingInvite | null> {
  const token = id.trim()
  if (!token) return null

  try {
    const sql = sqlClient()
    if (isUuidToken(token)) {
      const rows = await sql`
        SELECT id, owner_user_id, business_line, caller_phone, source, short_code, prefill
        FROM booking_invites
        WHERE id = ${token}::uuid
          AND expires_at > now()
        LIMIT 1
      `
      return mapInviteRow(rows[0])
    }
    if (isShortCodeToken(token)) {
      const rows = await sql`
        SELECT id, owner_user_id, business_line, caller_phone, source, short_code, prefill
        FROM booking_invites
        WHERE short_code = ${token.toUpperCase()}
          AND expires_at > now()
        LIMIT 1
      `
      return mapInviteRow(rows[0])
    }
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Pre-176 fallback: same lookups without prefill (short /b codes still resolve).
    if (msg.includes("prefill")) {
      try {
        const sql = sqlClient()
        if (isUuidToken(token)) {
          const rows = await sql`
            SELECT id, owner_user_id, business_line, caller_phone, source, short_code
            FROM booking_invites
            WHERE id = ${token}::uuid
              AND expires_at > now()
            LIMIT 1
          `
          return mapInviteRow(rows[0])
        }
        if (isShortCodeToken(token)) {
          const rows = await sql`
            SELECT id, owner_user_id, business_line, caller_phone, source, short_code
            FROM booking_invites
            WHERE short_code = ${token.toUpperCase()}
              AND expires_at > now()
            LIMIT 1
          `
          return mapInviteRow(rows[0])
        }
        return null
      } catch (e2) {
        console.warn("[booking-invite] lookup failed:", e2)
        return null
      }
    }
    // Pre-131 fallback without short_code.
    if (msg.includes("short_code") && isUuidToken(token)) {
      try {
        const sql = sqlClient()
        const rows = await sql`
          SELECT id, owner_user_id, business_line, caller_phone, source
          FROM booking_invites
          WHERE id = ${token}::uuid
            AND expires_at > now()
          LIMIT 1
        `
        return mapInviteRow(rows[0])
      } catch (e2) {
        console.warn("[booking-invite] lookup failed:", e2)
        return null
      }
    }
    console.warn("[booking-invite] lookup failed:", e)
    return null
  }
}

function mapInviteRow(row: unknown): BookingInvite | null {
  const r = row as
    | {
        id: string
        owner_user_id: string
        business_line: string
        caller_phone: string | null
        source: string
        short_code?: string | null
        prefill?: unknown
      }
    | undefined
  if (!r?.id) return null
  return {
    id: String(r.id),
    ownerUserId: String(r.owner_user_id),
    businessLine: String(r.business_line),
    callerPhone: r.caller_phone ? String(r.caller_phone) : null,
    source: String(r.source || "ivr"),
    shortCode: r.short_code ? String(r.short_code) : null,
    prefill: parseInvitePrefill(r.prefill),
  }
}

/** Query-string fallback when invite table is missing. */
export function buildBookQueryUrl(opts: {
  callerPhone?: string | null
  businessLine: string
  bookBaseUrl?: string
  /**
   * Missed-call recovery: open /book in availability + follow-up mode
   * (no open-slot picker). Plain booking links leave this false.
   */
  callbackMode?: boolean
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
  // ?mode=callback tells BookPageClient to skip the slot picker.
  const modeQs = opts.callbackMode ? "&mode=callback" : ""
  return `${base}?${phoneQs}line=${line}${modeQs}`
}
