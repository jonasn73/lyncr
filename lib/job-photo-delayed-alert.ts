// Delayed job-photo / intake-rescue upload → Pusher toast + Telnyx SMS to the operator device.

import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getAppUrl } from "@/lib/telnyx"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  isOperatorDashboardActive,
  PHOTO_UPLOAD_ALERT_ALWAYS_SMS,
  PHOTO_UPLOAD_ALERT_OPERATOR_E164,
} from "@/lib/operator-dashboard-heartbeat"
import type { JobPhotoTokenRow } from "@/lib/job-photo-request"

/** Ticket wait / ready states that should notify the operator. */
export const PHOTO_ALERT_TICKET_STATUSES = new Set([
  "awaiting_photos",
  "pending_info",
  "info_received",
])

export function isPhotoWaitTicketStatus(status: string | null | undefined): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
  return PHOTO_ALERT_TICKET_STATUSES.has(s)
}

export function buildPhotoUploadAlertSms(params: {
  phoneNumber: string
  ticketId: string
  kind?: "photo" | "intake_rescue"
}): string {
  const display = formatPhoneDisplay(params.phoneNumber) || params.phoneNumber || "unknown"
  const base = getAppUrl().replace(/\/+$/, "")
  const ticketId = params.ticketId.trim() || "unknown"
  const url = `${base}/dashboard?id=${encodeURIComponent(ticketId)}`
  if (params.kind === "intake_rescue") {
    return `Lyncr Alert: Customer completed Pending Info Intake for ${display}. View details: ${url}`
  }
  return `Lyncr Alert: New photos uploaded for customer ${display}. View details: ${url}`
}

/**
 * After a successful photo / rescue save: broadcast notification.photo_uploaded
 * and optionally SMS the operator (solo fail-safe always SMS).
 */
export async function notifyDelayedJobPhotoUpload(params: {
  token: JobPhotoTokenRow
  photoCount: number
  /** Bypass anti-spam when a full intake-rescue form is submitted. */
  force?: boolean
  kind?: "photo" | "intake_rescue"
}): Promise<void> {
  const { token } = params
  if (!isPhotoWaitTicketStatus(token.ticket_status)) return
  if (!params.force && token.operator_alert_sent_at) return

  const phoneNumber = token.customer_phone?.trim() || "unknown"
  const ticketId = token.call_log_id?.trim() || token.id
  const displayPhone = formatPhoneDisplay(phoneNumber) || phoneNumber
  const customerName = token.customer_name?.trim() || null

  await publishOwnerEvent(token.owner_user_id, "notification.photo_uploaded", {
    token_id: token.id,
    call_log_id: token.call_log_id,
    ticket_id: ticketId,
    phone_number: phoneNumber,
    phone_display: displayPhone,
    customer_name: customerName,
    photo_count: params.photoCount,
    ticket_status: token.ticket_status,
    kind: params.kind || "photo",
    vehicle_year: token.vehicle_year,
    vehicle_make: token.vehicle_make,
    vehicle_model: token.vehicle_model,
    vehicle_trim: token.vehicle_trim,
    vehicle_vin: token.vehicle_vin,
    special_notes: token.special_notes,
    message: customerName
      ? `New intake info received for ${customerName} (${displayPhone}).`
      : `New photos received for client ${displayPhone}.`,
    view_intake_url: `/dashboard?id=${encodeURIComponent(ticketId)}`,
  })

  const dashboardActive = await isOperatorDashboardActive(token.owner_user_id)
  const shouldSms = !dashboardActive || PHOTO_UPLOAD_ALERT_ALWAYS_SMS
  if (shouldSms) {
    const text = buildPhotoUploadAlertSms({
      phoneNumber: displayPhone,
      ticketId,
      kind: params.kind,
    })
    const sent = await sendTelnyxSms({
      toE164: PHOTO_UPLOAD_ALERT_OPERATOR_E164,
      text,
      userId: token.owner_user_id,
    })
    if (!sent.ok) {
      console.warn("[job-photos] operator alert SMS failed:", sent.error)
    }
  }

  const { markJobPhotoOperatorAlertSent } = await import("@/lib/job-photo-request")
  await markJobPhotoOperatorAlertSent(token.id)
}
