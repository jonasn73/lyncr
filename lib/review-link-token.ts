// Short lyncr.app/rv/{token} review links — redirect to Google + count opens.

import { neon } from "@neondatabase/serverless"
import { getAppUrl } from "@/lib/telnyx"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingReviewTokensTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /review_link_tokens/i.test(msg) && /does not exist|undefined_table/i.test(msg)
}

/** Short opaque token for SMS (same alphabet as receipt tokens). */
export function makeReviewToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return out
}

export type ReviewLinkTokenRow = {
  token: string
  owner_user_id: string
  lead_id: string | null
  destination_url: string
  customer_phone: string | null
  click_count: number
  first_clicked_at: string | null
  last_clicked_at: string | null
  created_at: string
}

/** Create a tracked review URL that redirects to the real Google (or other) link. */
export async function createTrackedReviewUrl(params: {
  ownerUserId: string
  destinationUrl: string
  leadId?: string | null
  customerPhone?: string | null
}): Promise<string | null> {
  const dest = params.destinationUrl.trim()
  if (!dest) return null
  const ownerUserId = params.ownerUserId.trim()
  if (!ownerUserId) return null

  const sql = getSql()
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = makeReviewToken()
    try {
      await sql`
        INSERT INTO review_link_tokens (
          token, owner_user_id, lead_id, destination_url, customer_phone, created_at
        )
        VALUES (
          ${token},
          ${ownerUserId}::uuid,
          ${params.leadId?.trim() || null},
          ${dest},
          ${params.customerPhone?.trim() || null},
          now()
        )
      `
      return `${getAppUrl()}/rv/${token}`
    } catch (e) {
      if (isMissingReviewTokensTable(e)) {
        console.warn(
          "[review-link] run scripts/119-sms-delivery-and-review-clicks.sql — using raw review URL"
        )
        return dest
      }
      // Token collision — retry.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/duplicate|unique/i.test(msg)) throw e
    }
  }
  return dest
}

/** Look up token and record a click; returns destination URL or null. */
export async function resolveAndClickReviewToken(token: string): Promise<string | null> {
  const t = token.trim()
  if (!t) return null
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE review_link_tokens
      SET
        click_count = click_count + 1,
        first_clicked_at = COALESCE(first_clicked_at, now()),
        last_clicked_at = now()
      WHERE token = ${t}
      RETURNING destination_url
    `
    const dest = rows[0]?.destination_url
    return dest != null ? String(dest) : null
  } catch (e) {
    if (isMissingReviewTokensTable(e)) return null
    throw e
  }
}

/** Latest review-link click stats for a job (Just finished strip). */
export async function getReviewLinkStatsForLead(
  ownerUserId: string,
  leadId: string
): Promise<{ click_count: number; first_clicked_at: string | null } | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT click_count, first_clicked_at
      FROM review_link_tokens
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND lead_id = ${leadId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      click_count: Number(row.click_count ?? 0),
      first_clicked_at:
        row.first_clicked_at instanceof Date
          ? row.first_clicked_at.toISOString()
          : row.first_clicked_at != null
            ? String(row.first_clicked_at)
            : null,
    }
  } catch (e) {
    if (isMissingReviewTokensTable(e)) return null
    throw e
  }
}
