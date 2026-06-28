// Booking confirmation SMS to the caller after answered-call intake creates an unassigned job.

import { SITE_NAME } from "@/lib/brand"
import { getUser, isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

const CANCELLATION_POLICY =
  "Cancellations requested within 5 minutes of dispatch incur no charge. Cancellations after 5 minutes will be subject to a fee."

export function buildIntakeBookingTrackingUrl(leadId: string): string {
  const base = getAppUrl().replace(/\/$/, "")
  return `${base}/dashboard/scheduler?focus=${encodeURIComponent(leadId)}`
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
}): Promise<{ sent: boolean; error: string | null; tracking_url: string }> {
  const toE164 = normalizePhoneNumberE164(params.customerPhoneE164)
  if (!isReasonablePstnDialString(toE164)) {
    return { sent: false, error: "Invalid customer phone number.", tracking_url: buildIntakeBookingTrackingUrl(params.leadId) }
  }

  const owner = await getUser(params.ownerUserId)
  const trackingUrl = buildIntakeBookingTrackingUrl(params.leadId)
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
