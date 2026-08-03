// Owner alerts when a customer finishes the public /book (or Activity book-link) form.
// Latest SMS + optional instant lead SMS — createUnassignedJobFromIntake alone only fires Pusher.

import { updateAiLeadSmsOutcome } from "@/lib/db"
import { dispatchLeadSmsAlert } from "@/lib/intake-engine"
import { notifyOwnerLatestNeedsAttention } from "@/lib/latest-attention-sms"

/** Intake sources that mean the customer submitted a book / callback form. */
export const BOOK_FORM_INTAKE_SOURCES = new Set([
  "public_book_asap",
  "public_book_window",
  "public_book",
  "activity_book_link",
])

export function isBookFormIntakeSource(source: string | null | undefined): boolean {
  const s = (source || "").trim()
  return BOOK_FORM_INTAKE_SOURCES.has(s)
}

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

  // Owner Latest SMS (sms_latest_enabled) — works even when Instant lead SMS is off.
  await notifyOwnerLatestNeedsAttention({
    userId: params.ownerUserId,
    event: "book_form",
    customerPhone: params.callerE164,
    customerName: who,
    jobId: params.leadId,
    preview: `Customer submitted book form · ${urgencyLabel}`,
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
      },
      summary:
        params.summary?.trim() ||
        `Customer submitted book form · ${urgencyLabel} — ${who}`,
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
