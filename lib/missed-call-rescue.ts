// Missed Call Rescue — SMS booking link after abandoned IVR / unanswered inbound.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { normalizePhoneNumberE164, getUserByPhoneNumber } from "@/lib/db"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { toE164 } from "@/lib/phone-e164"
import { getMissedCallTextbackEnabled } from "@/lib/missed-call-textback"
import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import { buildTelnyxMenuBookingSms } from "@/lib/telnyx-menu"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

/** True when we already texted this customer in the last 2 hours. */
export async function hasOutboundSmsToCustomerRecently(params: {
  ownerUserId: string
  customerPhone: string
  withinHours?: number
}): Promise<boolean> {
  const phone = normalizePhoneNumberE164(params.customerPhone) || toE164(params.customerPhone)
  if (!phone) return false
  const digits = phone.replace(/\D/g, "").slice(-10)
  const hours = params.withinHours ?? 2
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT id FROM sms_messages
      WHERE owner_user_id = ${params.ownerUserId}
        AND direction = 'outbound'
        AND created_at > now() - (${hours}::text || ' hours')::interval
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
    console.warn("[missed-call-rescue] SMS lookback failed:", e)
    return false
  }
}

export async function markIvrActionCompleted(callSid: string): Promise<void> {
  if (!callSid.trim()) return
  const sql = sqlClient()
  try {
    await sql`
      UPDATE call_logs
      SET ivr_action_completed = true
      WHERE provider_call_sid = ${callSid} OR twilio_call_sid = ${callSid}
    `
  } catch (e) {
    // Column may be missing pre-migration — ignore.
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("ivr_action_completed")) {
      console.warn("[missed-call-rescue] mark IVR complete failed:", e)
    }
  }
}

async function wasIvrActionCompleted(callSid: string): Promise<boolean> {
  if (!callSid.trim()) return false
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT ivr_action_completed FROM call_logs
      WHERE provider_call_sid = ${callSid} OR twilio_call_sid = ${callSid}
      LIMIT 1
    `
    return (rows[0] as { ivr_action_completed?: boolean } | undefined)?.ivr_action_completed === true
  } catch {
    return false
  }
}

/**
 * After a terminal inbound status: if the caller never completed an IVR action
 * and we haven't texted them in 2h, send the Missed Call Rescue booking link.
 */
export async function maybeSendMissedCallRescueSms(params: {
  callSid: string
  callStatus: string
  fromNumber: string
  toNumber: string
  /** When true, this call used the IVR menu path (or short abandoned talk time). */
  preferRescue?: boolean
}): Promise<{ sent: boolean; reason: string }> {
  const status = params.callStatus.trim().toLowerCase()
  const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status)
  if (!terminal) return { sent: false, reason: "not_terminal" }

  if (await wasIvrActionCompleted(params.callSid)) {
    return { sent: false, reason: "ivr_action_completed" }
  }

  const from = normalizePhoneNumberE164(params.fromNumber) || toE164(params.fromNumber)
  const to = normalizePhoneNumberE164(params.toNumber) || toE164(params.toNumber)
  if (!from || !to) return { sent: false, reason: "missing_phones" }

  const owner = await getUserByPhoneNumber(to)
  if (!owner) return { sent: false, reason: "unknown_line" }

  // Account toggle — Lines "Missed Call Rescue" card.
  if (!(await getMissedCallTextbackEnabled(owner.id))) {
    return { sent: false, reason: "textback_disabled" }
  }

  // Only rescue short / unanswered legs (or explicitly flagged IVR abandons).
  const prefer = params.preferRescue === true
  if (!prefer && status === "completed") {
    // completed with talk time often means a human answered — skip unless flagged.
    // PreferRescue is set from IVR menu hangup / Gather timeout path.
    return { sent: false, reason: "completed_without_ivr_flag" }
  }

  if (await hasOutboundSmsToCustomerRecently({ ownerUserId: owner.id, customerPhone: from })) {
    return { sent: false, reason: "sms_within_2h" }
  }

  const result = await sendMissedCallRescueBookingLink({
    ownerUserId: owner.id,
    customerPhone: from,
    businessLine: to,
    source: "missed_call_textback",
  })
  return result.ok
    ? { sent: true, reason: "sent" }
    : { sent: false, reason: result.error || "sms_failed" }
}

/**
 * Operator-triggered (or auto) booking-link SMS — creates a /book/[id] invite when possible.
 * Skips the 2h anti-spam window so "Re-send SMS Link" always fires.
 */
export async function sendMissedCallRescueBookingLink(params: {
  ownerUserId: string
  customerPhone: string
  businessLine?: string | null
  source?: string
}): Promise<{ ok: boolean; error?: string }> {
  const customer =
    normalizePhoneNumberE164(params.customerPhone) || toE164(params.customerPhone)
  if (!customer) return { ok: false, error: "invalid_customer_phone" }

  const lineRaw = params.businessLine?.trim() || ""
  const line = lineRaw
    ? normalizePhoneNumberE164(lineRaw) || toE164(lineRaw) || lineRaw
    : ""

  let bookUrl = ""
  if (line) {
    const created = await createBookingInvite({
      ownerUserId: params.ownerUserId,
      businessLine: line,
      callerPhone: customer,
      source: params.source || "missed_call_rescue_resend",
    })
    bookUrl = created?.url || ""
  }
  if (!bookUrl) {
    bookUrl = buildBookQueryUrl({
      callerPhone: customer,
      businessLine: line || customer,
    })
  }

  const text = buildTelnyxMenuBookingSms(customer, bookUrl, line || null)

  try {
    // Log outbound textback into sms_messages so Messages inbox shows the thread.
    const sent = await sendAndLogWorkspaceCustomerSms({
      ownerUserId: params.ownerUserId,
      toE164: customer,
      text,
      fromE164: line || null,
    })
    if (!sent.ok) {
      console.warn("[missed-call-rescue] booking link SMS failed:", sent.error)
      return { ok: false, error: sent.error || "sms_failed" }
    }
    return { ok: true }
  } catch (e) {
    console.warn("[missed-call-rescue] booking link SMS threw:", e)
    return { ok: false, error: e instanceof Error ? e.message : "error" }
  }
}
