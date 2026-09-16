// Customer SMS opt-outs — the app-side mirror of the carrier's STOP handling.
//
// Telnyx/carriers already block sends to a number that replied STOP (10DLC),
// but before this the app had no record: automations (rescue texts, follow-ups,
// review requests) kept attempting sends that failed at the carrier, and a
// manual Messages send just errored with no explanation. Now the inbound
// webhook records the STOP, every send through sendTelnyxSms is suppressed
// with a clear reason, and START/UNSTOP lifts it.
//
// Standard CTIA keywords, exact-match only ("stop please" is a sentence, not
// an opt-out — the carrier applies the same rule).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { lyncrLog } from "@/lib/lyncr-env"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function last10Digits(phone: string | null | undefined): string {
  return String(phone || "")
    .replace(/\D/g, "")
    .slice(-10)
}

const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i
const START_WORDS = /^(start|unstop|yes)$/i

/**
 * Classify an inbound body as an opt-out / opt-in keyword. "start" is only
 * meaningful for a currently opted-out number — the caller checks that.
 */
export function parseSmsOptOutKeyword(text: string): "stop" | "start" | null {
  const t = String(text || "")
    .trim()
    .replace(/[.!]+$/, "")
  if (STOP_WORDS.test(t)) return "stop"
  if (START_WORDS.test(t)) return "start"
  return null
}

export async function recordSmsOptOut(params: {
  ownerUserId: string
  phone: string
  source?: string
}): Promise<void> {
  const digits = last10Digits(params.phone)
  if (digits.length < 10 || !params.ownerUserId) return
  try {
    const sql = sqlClient()
    await sql`
      INSERT INTO sms_opt_outs (owner_user_id, phone_digits, source)
      VALUES (${params.ownerUserId}::uuid, ${digits}, ${params.source || "sms_stop"})
      ON CONFLICT (owner_user_id, phone_digits) DO UPDATE SET opted_out_at = now()
    `
    console.log(lyncrLog("sms-opt-out-recorded", { ownerUserId: params.ownerUserId }))
  } catch (e) {
    console.warn(lyncrLog("sms-opt-out-record-failed", { error: String(e) }))
  }
}

export async function clearSmsOptOut(params: {
  ownerUserId: string
  phone: string
}): Promise<boolean> {
  const digits = last10Digits(params.phone)
  if (digits.length < 10 || !params.ownerUserId) return false
  try {
    const sql = sqlClient()
    const rows = await sql`
      DELETE FROM sms_opt_outs
      WHERE owner_user_id = ${params.ownerUserId}::uuid AND phone_digits = ${digits}
      RETURNING id
    `
    const cleared = rows.length > 0
    if (cleared) console.log(lyncrLog("sms-opt-out-cleared", { ownerUserId: params.ownerUserId }))
    return cleared
  } catch (e) {
    console.warn(lyncrLog("sms-opt-out-clear-failed", { error: String(e) }))
    return false
  }
}

/** Fails open — an opt-out lookup error must never block legitimate sends. */
export async function isSmsOptedOut(params: {
  ownerUserId: string
  phone: string
}): Promise<boolean> {
  const digits = last10Digits(params.phone)
  if (digits.length < 10 || !params.ownerUserId) return false
  try {
    const sql = sqlClient()
    const rows = await sql`
      SELECT 1 FROM sms_opt_outs
      WHERE owner_user_id = ${params.ownerUserId}::uuid AND phone_digits = ${digits}
      LIMIT 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

/** The error every suppressed send returns — Messages surfaces it verbatim. */
export const SMS_OPTED_OUT_ERROR =
  "This customer opted out of texts (replied STOP). They can text START to resume."
