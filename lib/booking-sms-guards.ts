// Missed Call Rescue — SMS booking link after abandoned IVR / unanswered inbound.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  normalizePhoneNumberE164,
  getUserByPhoneNumber,
  getPhoneNumbers,
  getCallLogSnapshotForTelemetry,
} from "@/lib/db"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { toE164 } from "@/lib/phone-e164"
import { getMissedCallTextbackEnabled } from "@/lib/missed-call-textback"
import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import {
  buildTelnyxMenuBookingSms,
  type BookingLinkSmsTone,
} from "@/lib/telnyx-menu"
import { isAutomatedCallHandler } from "@/lib/missed-call-telemetry"
import {
  isCaptureMissedLinkStatus,
  isHoldAutomationStatus,
} from "@/lib/inbound-time-capture"
import { smsBodiesLookDuplicate } from "@/lib/sms-dedupe"

/** Pick SMS tone from invite/source tags — missed recovery vs plain booking link. */
export function bookingLinkSmsToneFromSource(source?: string | null): BookingLinkSmsTone {
  const s = (source || "").trim().toLowerCase()
  // Hold max-wait / queue cap — soft “still want to book?” (not press-1, not miss apology).
  if (
    s === "cc_busy_hold_max_wait" ||
    s === "cc_busy_hold_cap" ||
    s.includes("hold_max_wait") ||
    s.includes("max_wait")
  ) {
    return "hold_timeout"
  }
  // Auto textback + Missed Call Rescue UI + missed-lead banner / activity missed.
  if (
    s === "missed_call_textback" ||
    s === "missed_call_rescue_resend" ||
    s === "missed_lead_banner" ||
    s === "missed_call_activity" ||
    s.startsWith("missed_")
  ) {
    return "missed_call"
  }
  // Operator “Text booking link” on a live call, IVR Digit 1, follow-ups, etc.
  return "booking_link"
}

/**
 * True when /book should show the availability + callback form
 * (not the open-slot picker). Branch from invite `source` or ?mode=callback.
 */
export function isMissedCallBookingCallbackMode(source?: string | null): boolean {
  // Same tags as warm SMS — missed path asks for availability, not a hard slot.
  return bookingLinkSmsToneFromSource(source) === "missed_call"
}

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

/** True when we already texted this customer recently (supports fractional hours). */
export async function hasOutboundSmsToCustomerRecently(params: {
  ownerUserId: string
  customerPhone: string
  /** Default 0.75h (45 min) — shared with press-1 / hold / rescue dedupe. */
  withinHours?: number
}): Promise<boolean> {
  const phone = normalizePhoneNumberE164(params.customerPhone) || toE164(params.customerPhone)
  if (!phone) return false
  const digits = phone.replace(/\D/g, "").slice(-10)
  const hours = params.withinHours ?? 0.75
  // Convert to minutes so Neon interval accepts fractional hours cleanly.
  const minutes = Math.max(1, Math.round(hours * 60))
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT id FROM sms_messages
      WHERE owner_user_id = ${params.ownerUserId}
        AND direction = 'outbound'
        AND created_at > now() - (${minutes}::text || ' minutes')::interval
        AND (
          to_number = ${phone}
          OR customer_phone = ${phone}
          OR RIGHT(regexp_replace(COALESCE(to_number, ''), '[^0-9]', '', 'g'), 10) = ${digits}
          OR RIGHT(regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
        )
      LIMIT 1
    `
    return (rows as unknown[]).length > 0
  } catch (e) {
    console.warn("[booking-sms-guards] SMS lookback failed:", e)
    return false
  }
}


/** Last few shop texts to this phone (used to skip a second booked / follow-up SMS). */
async function recentOutboundSmsBodies(params: {
  ownerUserId: string
  customerPhone: string
  /** Default 45 minutes — same window as missed-call rescue. */
  withinHours?: number
}): Promise<string[]> {
  const phone = normalizePhoneNumberE164(params.customerPhone) || toE164(params.customerPhone)
  if (!phone) return []
  const digits = phone.replace(/\D/g, "").slice(-10)
  const hours = params.withinHours ?? 0.75
  const minutes = Math.max(1, Math.round(hours * 60))
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT body FROM sms_messages
      WHERE owner_user_id = ${params.ownerUserId}
        AND direction = 'outbound'
        AND created_at > now() - (${minutes}::text || ' minutes')::interval
        AND (
          to_number = ${phone}
          OR customer_phone = ${phone}
          OR RIGHT(regexp_replace(COALESCE(to_number, ''), '[^0-9]', '', 'g'), 10) = ${digits}
          OR RIGHT(regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
        )
      ORDER BY created_at DESC
      LIMIT 10
    `
    return (rows as { body?: string }[])
      .map((r) => String(r.body || "").trim())
      .filter(Boolean)
  } catch (e) {
    console.warn("[booking-sms-guards] SMS body lookback failed:", e)
    return []
  }
}

/** True when we would send the same kind of follow-up they already got. */
export async function wouldDuplicateRecentCustomerSms(params: {
  ownerUserId: string
  customerPhone: string
  candidateText: string
  withinHours?: number
}): Promise<boolean> {
  const bodies = await recentOutboundSmsBodies(params)
  return bodies.some((prior) => smsBodiesLookDuplicate(prior, params.candidateText))
}

export async function markIvrActionCompleted(callSid: string): Promise<void> {
  if (!callSid.trim()) return
  const sql = sqlClient()
  try {
    await sql`
      UPDATE call_logs
      SET ivr_action_completed = true
      WHERE provider_call_sid = ${callSid}
    `
  } catch (e) {
    // Column may be missing pre-migration — ignore.
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("ivr_action_completed")) {
      console.warn("[booking-sms-guards] mark IVR complete failed:", e)
    }
  }
}

async function wasIvrActionCompleted(callSid: string): Promise<boolean> {
  if (!callSid.trim()) return false
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT ivr_action_completed FROM call_logs
      WHERE provider_call_sid = ${callSid}
      LIMIT 1
    `
    return (rows[0] as { ivr_action_completed?: boolean } | undefined)?.ivr_action_completed === true
  } catch {
    return false
  }
}

/**
 * First webhook wins. Returns true = this request may send SMS.
 * If there is no call log row yet, we still allow send (do not skip a real miss).
 * If a row exists and is already claimed, skip.
 */
export async function claimIvrAction(callSid: string): Promise<boolean> {
  if (!callSid.trim()) return false
  const sql = sqlClient()
  try {
    const claimed = await sql`
      UPDATE call_logs
      SET ivr_action_completed = true
      WHERE (provider_call_sid = ${callSid})
        AND COALESCE(ivr_action_completed, false) = false
      RETURNING id
    `
    if ((claimed as unknown[]).length > 0) return true
    const existing = await sql`
      SELECT id
      FROM call_logs
      WHERE provider_call_sid = ${callSid}
      LIMIT 1
    `
    // No row → still send (cooldown on the SMS itself covers a later double).
    if ((existing as unknown[]).length === 0) return true
    // Row exists but we did not claim it → another webhook already won.
    return false
  } catch {
    // If the column is missing, still allow one send (old DBs).
    return !(await wasIvrActionCompleted(callSid))
  }
}


