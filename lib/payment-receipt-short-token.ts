// Short lyncr.app/r/{token} links for SMS invoices (same style as pay links).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingReceiptTokensTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /payment_receipt_tokens/i.test(msg) && /does not exist|undefined_table/i.test(msg)
}

/** Short opaque token for SMS (avoids a multi-line signed URL). */
export function makeReceiptToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return out
}

export type ReceiptTokenRow = {
  token: string
  ownerUserId: string
  paymentIntentId: string
}

/** Return existing short token for this PI, or create one. */
export async function getOrCreateReceiptToken(params: {
  paymentIntentId: string
  ownerUserId: string
}): Promise<string> {
  const pi = params.paymentIntentId.trim()
  const ownerUserId = params.ownerUserId.trim()
  if (!pi || !ownerUserId) throw new Error("Missing payment or owner for receipt link")

  const sql = getSql()
  try {
    const existing = await sql`
      SELECT token
      FROM payment_receipt_tokens
      WHERE stripe_payment_intent_id = ${pi}
      LIMIT 1
    `
    const row = existing[0] as { token?: string } | undefined
    if (row?.token) return String(row.token)

    // Retry a few times on the rare primary-key collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = makeReceiptToken()
      try {
        await sql`
          INSERT INTO payment_receipt_tokens (
            token,
            owner_user_id,
            stripe_payment_intent_id
          )
          VALUES (
            ${token},
            ${ownerUserId}::uuid,
            ${pi}
          )
          ON CONFLICT (stripe_payment_intent_id) DO NOTHING
        `
        const again = await sql`
          SELECT token
          FROM payment_receipt_tokens
          WHERE stripe_payment_intent_id = ${pi}
          LIMIT 1
        `
        const saved = again[0] as { token?: string } | undefined
        if (saved?.token) return String(saved.token)
      } catch (e) {
        if (isMissingReceiptTokensTable(e)) {
          throw new Error(
            "Database needs migration 115 — run scripts/115-payment-receipt-tokens.sql in Neon SQL Editor"
          )
        }
        // Unique token collision — try another token.
        const msg = e instanceof Error ? e.message : String(e)
        if (/duplicate key|unique/i.test(msg)) continue
        throw e
      }
    }
    throw new Error("Could not create a short invoice link")
  } catch (e) {
    if (isMissingReceiptTokensTable(e)) {
      throw new Error(
        "Database needs migration 115 — run scripts/115-payment-receipt-tokens.sql in Neon SQL Editor"
      )
    }
    throw e
  }
}

/** Resolve a short receipt token to PI + owner. */
export async function resolveReceiptToken(token: string): Promise<ReceiptTokenRow | null> {
  const t = token.trim()
  if (!t || t.length < 6 || t.length > 40) return null
  // Reject the old long HMAC tokens here (those are verified separately).
  if (t.includes(".")) return null

  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        token,
        owner_user_id::text AS owner_user_id,
        stripe_payment_intent_id
      FROM payment_receipt_tokens
      WHERE token = ${t}
      LIMIT 1
    `
    const row = rows[0] as
      | { token?: string; owner_user_id?: string; stripe_payment_intent_id?: string }
      | undefined
    if (!row?.token || !row.owner_user_id || !row.stripe_payment_intent_id) return null
    return {
      token: String(row.token),
      ownerUserId: String(row.owner_user_id),
      paymentIntentId: String(row.stripe_payment_intent_id),
    }
  } catch (e) {
    if (isMissingReceiptTokensTable(e)) return null
    throw e
  }
}
