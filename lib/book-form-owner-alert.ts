// Owner alerts when a customer finishes the public /book (or Activity book-link) form.
// Latest SMS + optional instant lead SMS — createUnassignedJobFromIntake alone only fires Pusher.

import { updateAiLeadSmsOutcome } from "@/lib/db"
import { dispatchLeadSmsAlert } from "@/lib/intake-engine"
import { notifyOwnerLatestNeedsAttention } from "@/lib/latest-attention-sms"
import { isHoldPress1BookingSource } from "@/lib/owner-live-call"

export {
  BOOK_FORM_INTAKE_SOURCES,
  isBookFormIntakeSource,
  crmIntakeFilledByLabel,
} from "@/lib/book-form-sources"

export type NotifyOwnerBookFormParams = {
  ownerUserId: string
  leadId: string
  callerE164: string | null
  customerName: string | null
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
 * After a book-form lead is saved: Latest-attention SMS + optional instant lead SMS.
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

  // Hold / press-1 path gets a clearer Latest + SMS headline.
  const fromHold = isHoldPress1BookingSource(params.bookingSource)
  const latestPreview = fromHold
    ? `Booked from hold · press 1 · ${urgencyLabel}`
    : `Customer submitted book form · ${urgencyLabel}`
  const leadSummary = fromHold
    ? `Booked from hold · press 1 · ${urgencyLabel} — ${who}`
    : params.summary?.trim() || `Customer submitted book form · ${urgencyLabel} — ${who}`

  // Owner Latest SMS (sms_latest_enabled) — works even when Instant lead SMS is off.
  await notifyOwnerLatestNeedsAttention({
    userId: params.ownerUserId,
    event: "book_form",
    customerPhone: params.callerE164,
    customerName: who,
    jobId: params.leadId,
    preview: latestPreview,
  }).catch((e) => console.warn("[book-form-owner-alert] latest SMS failed:", e))

  // Instant lead SMS when Settings → Instant SMS lead alerts is on.
  try {
    const sms = await dispatchLeadSmsAlert({
      userId: params.ownerUserId,
      leadId: params.leadId,
      caller_e164: params.callerE164,
      intent_slug: params.intentSlug ?? null,
      collected: {
        ...(params.collected || {}),
        customer_name: who,
        urgency,
        availability: preview,
        booking_source: params.bookingSource || null,
      },
      summary: leadSummary,
    })
    if (sms.sms_sent || sms.sms_error) {
      await updateAiLeadSmsOutcome(params.leadId, {
        sms_sent: sms.sms_sent,
        sms_error: sms.sms_error,
      })
    }
  } catch (e) {
    console.warn("[book-form-owner-alert] lead SMS failed:", e)
  }
}
