// Owner alerts when a customer finishes the public /book (or Activity book-link) form.
// One full owner SMS through Instant lead alerts or, if that is off, Latest alerts.

import { updateAiLeadSmsOutcome } from "@/lib/db"
import { dispatchLeadSmsAlert } from "@/lib/intake-engine"
import { notifyOwnerLatestNeedsAttention } from "@/lib/latest-attention-sms"
import { holdBookingSourceHeadline } from "@/lib/owner-live-call"

export type NotifyOwnerBookFormParams = {
  ownerUserId: string
  leadId: string
  callerE164: string | null
  customerName: string | null
  address: string | null
  jobType: string
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  customerEmail?: string | null
  notes?: string | null
  /** asap | window — drives Latest copy. */
  urgency: "asap" | "window" | string
  availabilityLabel?: string | null
  summary?: string | null
  collected?: Record<string, unknown>
  intentSlug?: string | null
  /** Invite / SMS source (e.g. cc_busy_hold_press1) — surfaces hold/press-1 in alerts. */
  bookingSource?: string | null
}

/**
 * After a book-form lead is saved: one full-detail owner SMS through the enabled alert path.
 * Pusher `lead-salvageable` with book_form is already published by createUnassignedJobFromIntake.
 */
export async function notifyOwnerBookFormSubmitted(
  params: NotifyOwnerBookFormParams
): Promise<void> {
  const urgency = String(params.urgency || "").toLowerCase() === "asap" ? "asap" : "window"
  const urgencyLabel = urgency === "asap" ? "ASAP" : "preferred window"
  const who = (params.customerName || "").trim() || "Customer"
  const preview =
    urgency === "asap"
      ? "ASAP / emergency"
      : (params.availabilityLabel || "").trim() || "Preferred window"

  // Hold / press-1 path gets a clearer Latest + SMS headline ("press 1" only when
  // the caller actually pressed it — timeout/capacity sends say "hold link").
  const holdHeadline = holdBookingSourceHeadline(params.bookingSource)
  const latestPreview = holdHeadline
    ? `${holdHeadline} · ${urgencyLabel}`
    : `Customer submitted book form · ${urgencyLabel}`
  const leadSummary = holdHeadline
    ? `${holdHeadline} · ${urgencyLabel} — ${who}`
    : params.summary?.trim() || `Customer submitted book form · ${urgencyLabel} — ${who}`
  const collected = {
    ...(params.collected || {}),
    customer_name: who,
    service_type: params.jobType,
    job_address: params.address,
    vehicle_year: params.vehicleYear || null,
    vehicle_make: params.vehicleMake || null,
    vehicle_model: params.vehicleModel || null,
    customer_email: params.customerEmail || null,
    customer_notes: params.notes || null,
    urgency,
    availability: preview,
    booking_source: params.bookingSource || null,
  }

  // Instant lead SMS when Settings → Instant SMS lead alerts is on.
  let leadSmsSent = false
  try {
    const sms = await dispatchLeadSmsAlert({
      userId: params.ownerUserId,
      leadId: params.leadId,
      caller_e164: params.callerE164,
      intent_slug: params.intentSlug ?? null,
      collected,
      summary: leadSummary,
    })
    leadSmsSent = sms.sms_sent
    if (sms.sms_sent || sms.sms_error) {
      await updateAiLeadSmsOutcome(params.leadId, {
        sms_sent: sms.sms_sent,
        sms_error: sms.sms_error,
      })
    }
  } catch (e) {
    console.warn("[book-form-owner-alert] lead SMS failed:", e)
  }

  // Latest is the fallback when Instant alerts are off or the send fails. Its
  // book-form text carries the same submitted fields, without a duplicate ping.
  if (!leadSmsSent) {
    await notifyOwnerLatestNeedsAttention({
      userId: params.ownerUserId,
      event: "book_form",
      customerPhone: params.callerE164,
      customerName: who,
      jobId: params.leadId,
      preview: latestPreview,
      bookFormLead: {
        intentSlug: params.intentSlug ?? null,
        collected,
        summary: leadSummary,
      },
    }).catch((e) => console.warn("[book-form-owner-alert] latest SMS failed:", e))
  }
}
