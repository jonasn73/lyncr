/**
 * Safe “we got your request” SMS from the shop line (never a control DID).
 * Used on ASAP submit and when a leftover ping sits unanswered.
 */

import { SITE_NAME } from "@/lib/brand"
import { getOwnerSmsSettings, getUser, updateAiLeadSmsOutcome } from "@/lib/db"
import {
  customerFirstName,
  buildGotItHoldingCustomerSms,
  formatVehicleForSms,
} from "@/lib/customer-sms-phrases"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"

/** Send a human holding note. No invented times, prices, or “we’re on the way.” */
export async function sendGotItHoldingCustomerSms(params: {
  ownerUserId: string
  organizationId?: string | null
  leadId?: string | null
  customerPhone: string
  customerName: string | null
  controlNumber?: string | null
  jobLabel?: string | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  vehicle?: string | null
  urgency?: string | null
  availabilityLabel?: string | null
  addressSnippet?: string | null
}): Promise<{ sent: boolean; error: string | null }> {
  // Load the shop name for the sign-off.
  const owner = await getUser(params.ownerUserId)
  const businessName =
    String(owner?.business_name ?? "").trim() ||
    String(owner?.name ?? "").trim() ||
    SITE_NAME
  // First name only — do not put address or full phone in the customer text.
  const first = customerFirstName(params.customerName)
  const vehicle =
    String(params.vehicle || "").trim() ||
    formatVehicleForSms({
      year: params.vehicleYear,
      make: params.vehicleMake,
      model: params.vehicleModel,
    })
  // Use the Follow-up wording from SMS templates when the owner saved one.
  const settings = await getOwnerSmsSettings(params.ownerUserId).catch(() => null)
  const text = buildGotItHoldingCustomerSms({
    customerFirstName: first,
    businessName,
    jobLabel: params.jobLabel,
    vehicle,
    urgency: params.urgency,
    availabilityLabel: params.availabilityLabel,
    addressSnippet: params.addressSnippet,
    template: settings?.sms_booking_template,
  })

  // Always From the business line, never a control DID.
  const sender = await resolveWorkspaceSmsSender(
    params.ownerUserId,
    params.organizationId ?? null
  )
  if (!sender.ok) {
    return { sent: false, error: sender.message || "No business line for customer SMS." }
  }
  const control = params.controlNumber?.trim() || ""
  if (control && sender.from_e164 === control) {
    return { sent: false, error: "Customer SMS cannot send from a control number." }
  }

  // Don't send the same booked / we-got-it note twice in 45 minutes.
  const { wouldDuplicateRecentCustomerSms } = await import("@/lib/booking-sms-guards")
  if (
    await wouldDuplicateRecentCustomerSms({
      ownerUserId: params.ownerUserId,
      customerPhone: params.customerPhone,
      candidateText: text,
    })
  ) {
    return { sent: true, error: null }
  }

  const sent = await sendAndLogWorkspaceCustomerSms({
    ownerUserId: params.ownerUserId,
    organizationId: params.organizationId ?? null,
    toE164: params.customerPhone,
    fromE164: sender.from_e164,
    text,
  })
  if (!sent.ok) {
    return { sent: false, error: sent.error || "Could not send the we-got-it text." }
  }
  if (sent.delivery_warning) {
    return { sent: false, error: sent.delivery_warning }
  }

  // Mark the lead so leftover cover knows a shop text already went out.
  if (params.leadId) {
    await updateAiLeadSmsOutcome(params.leadId, { sms_sent: true, sms_error: null }).catch(
      () => {}
    )
  }
  return { sent: true, error: null }
}
