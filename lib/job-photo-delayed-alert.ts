// Delayed job-photo upload → Pusher toast + Telnyx SMS to the operator device.

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

/** Ticket wait states that mean the shop is still waiting on customer photos. */
export const PHOTO_WAIT_TICKET_STATUSES = new Set(["awaiting_photos", "pending_info"])

/** Human labels matching the product copy (Pending Info / Awaiting Photos). */
export function isPhotoWaitTicketStatus(status: string | null | undefined): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
  return PHOTO_WAIT_TICKET_STATUSES.has(s)
}

/** Build the exact SMS body required for operator alerts. */
export function buildPhotoUploadAlertSms(params: {
  phoneNumber: string
  ticketId: string
}): string {
  // Prefer a readable display number in the body when we have one.
  const display = formatPhoneDisplay(params.phoneNumber) || params.phoneNumber || "unknown"
  // Deep-link into the dashboard intake ticket.
  const base = getAppUrl().replace(/\/+$/, "")
  const ticketId = params.ticketId.trim() || "unknown"
  const url = `${base}/dashboard?id=${encodeURIComponent(ticketId)}`
  return `Lyncr Alert: New photos uploaded for customer ${display}. View details: ${url}`
}

/**
 * After a successful photo save: if the ticket is still waiting on photos,
 * broadcast notification.photo_uploaded and optionally SMS the operator.
 */
export async function notifyDelayedJobPhotoUpload(params: {
  token: JobPhotoTokenRow
  photoCount: number
}): Promise<void> {
  const { token } = params
  // Only alert while the intake ticket is Pending Info / Awaiting Photos.
  if (!isPhotoWaitTicketStatus(token.ticket_status)) return
  // Avoid spamming on every extra photo for the same SMS link.
  if (token.operator_alert_sent_at) return

  const phoneNumber = token.customer_phone?.trim() || "unknown"
  const ticketId = token.call_log_id?.trim() || token.id
  const displayPhone = formatPhoneDisplay(phoneNumber) || phoneNumber

  // Account-wide workspace toast event for any open dashboard tab.
  await publishOwnerEvent(token.owner_user_id, "notification.photo_uploaded", {
    token_id: token.id,
    call_log_id: token.call_log_id,
    ticket_id: ticketId,
    phone_number: phoneNumber,
    phone_display: displayPhone,
    photo_count: params.photoCount,
    ticket_status: token.ticket_status,
    message: `New photos received for client ${displayPhone}.`,
    view_intake_url: `/dashboard?id=${encodeURIComponent(ticketId)}`,
  })

  // SMS when dashboard is inactive — or always for solo locksmith fail-safe.
  const dashboardActive = await isOperatorDashboardActive(token.owner_user_id)
  const shouldSms = !dashboardActive || PHOTO_UPLOAD_ALERT_ALWAYS_SMS
  if (shouldSms) {
    const text = buildPhotoUploadAlertSms({ phoneNumber: displayPhone, ticketId })
    const sent = await sendTelnyxSms({
      toE164: PHOTO_UPLOAD_ALERT_OPERATOR_E164,
      text,
      userId: token.owner_user_id,
    })
    if (!sent.ok) {
      console.warn("[job-photos] operator alert SMS failed:", sent.error)
    }
  }

  // Mark alert sent so further photos on this token do not re-SMS.
  const { markJobPhotoOperatorAlertSent } = await import("@/lib/job-photo-request")
  await markJobPhotoOperatorAlertSent(token.id)
}
