// Booking confirmation SMS to the caller after answered-call intake creates an unassigned job.

import { SITE_NAME } from "@/lib/brand"
import { createBookingInvite, buildBookQueryUrl } from "@/lib/booking-invite"
import {
  getPhoneNumbers,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

const CANCELLATION_POLICY =
  "Cancellations requested within 5 minutes of dispatch incur no charge. Cancellations after 5 minutes will be subject to a fee."

/** Resolve a business DID for the public /book link (call line → first owned line). */
async function resolveBusinessLine(params: {
  ownerUserId: string
  businessLine?: string | null
  callLogId?: string | null
}): Promise<string | null> {
  const fromArg = (params.businessLine ?? "").trim()
  if (fromArg) {
    return normalizePhoneNumberE164(fromArg) || fromArg
  }

  if (params.callLogId?.trim()) {
    try {
      const sql = neon(resolveNeonDatabaseUrl())
      const rows = await sql`
        SELECT to_number
        FROM call_logs
        WHERE id = ${params.callLogId.trim()}::uuid AND user_id = ${params.ownerUserId}
        LIMIT 1
      `
      const to = String(rows[0]?.to_number ?? "").trim()
      if (to) return normalizePhoneNumberE164(to) || to
    } catch {
      /* call log lookup is best-effort */
    }
  }

  try {
    const lines = await getPhoneNumbers(params.ownerUserId)
    const active = lines.find((n) => (n.status || "").toLowerCase() === "active") || lines[0]
    const num = active?.number?.trim()
    if (num) return normalizePhoneNumberE164(num) || num
  } catch {
    /* phone list optional */
  }
  return null
}

/** Public customer tracking URL — never /dashboard/* (login-gated). */
export async function buildIntakeBookingTrackingUrl(params: {
  ownerUserId: string
  leadId: string
  customerPhoneE164: string
  businessLine?: string | null
  callLogId?: string | null
}): Promise<string> {
  const line = await resolveBusinessLine({
    ownerUserId: params.ownerUserId,
    businessLine: params.businessLine,
    callLogId: params.callLogId,
  })
  const customer = normalizePhoneNumberE164(params.customerPhoneE164) || params.customerPhoneE164

  if (line) {
    const created = await createBookingInvite({
      ownerUserId: params.ownerUserId,
      businessLine: line,
      callerPhone: customer,
      source: "intake_booking",
    })
    if (created?.url) return created.url
    return buildBookQueryUrl({ callerPhone: customer, businessLine: line })
  }

  // Last resort: query-string book page (still public).
  return buildBookQueryUrl({
    callerPhone: customer,
    businessLine: customer,
  })
}

export function buildIntakeBookingCustomerSmsText(params: {
  customerName: string
  businessName: string
  trackingUrl: string
}): string {
  const first = params.customerName.split(/\s+/)[0]?.trim() || "there"
  const business = params.businessName.trim() || SITE_NAME
  return (
    `Hi ${first}, ${business} confirmed your service request. ` +
    `Track status & ETA: ${params.trackingUrl}\n\n` +
    CANCELLATION_POLICY
  )
}

export async function sendIntakeBookingCustomerSms(params: {
  ownerUserId: string
  leadId: string
  customerPhoneE164: string
  customerName: string
  businessLine?: string | null
  callLogId?: string | null
}): Promise<{ sent: boolean; error: string | null; tracking_url: string }> {
  const toE164 = normalizePhoneNumberE164(params.customerPhoneE164)
  if (!isReasonablePstnDialString(toE164)) {
    const tracking_url = await buildIntakeBookingTrackingUrl(params)
    return { sent: false, error: "Invalid customer phone number.", tracking_url }
  }

  const owner = await getUser(params.ownerUserId)
  const trackingUrl = await buildIntakeBookingTrackingUrl({
    ...params,
    customerPhoneE164: toE164,
  })
  const text = buildIntakeBookingCustomerSmsText({
    customerName: params.customerName,
    businessName: owner?.business_name?.trim() || owner?.name?.trim() || SITE_NAME,
    trackingUrl,
  })

  const res = await sendTelnyxSms({ toE164, text, userId: params.ownerUserId })
  if (!res.ok) {
    return { sent: false, error: res.error, tracking_url: trackingUrl }
  }
  return { sent: true, error: res.delivery_warning ?? null, tracking_url: trackingUrl }
}
