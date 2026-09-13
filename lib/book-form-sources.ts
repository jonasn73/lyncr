// Client-safe book-form source helpers (no DB / Telnyx / SMS imports).
// Used by CRM UI + server intake paths to label customer-filled vs operator-entered leads.

/** Intake sources that mean the customer submitted a book / callback form. */
export const BOOK_FORM_INTAKE_SOURCES = new Set([
  "public_book_asap",
  "public_book_window",
  "public_book",
  "activity_book_link",
])

/** collected.source tag for a job booked by answering a caller from the hold queue. */
export const HOLD_QUEUE_ANSWERED_INTAKE_SOURCE = "answered_call_hold_queue"

/** True when collected.source is a public /book or Activity book-link submission. */
export function isBookFormIntakeSource(source: string | null | undefined): boolean {
  const s = (source || "").trim()
  return BOOK_FORM_INTAKE_SOURCES.has(s)
}

/** True when collected.source means the operator answered this caller from the hold queue. */
export function isHoldQueueAnsweredIntakeSource(source: string | null | undefined): boolean {
  return (source || "").trim() === HOLD_QUEUE_ANSWERED_INTAKE_SOURCE
}

/** CRM badge copy — customer book link vs hold-queue live-answer vs plain operator intake. */
export function crmIntakeFilledByLabel(
  source: string | null | undefined
): "Filled by customer" | "Booked on call" | "Entered by you" {
  if (isBookFormIntakeSource(source)) return "Filled by customer"
  if (isHoldQueueAnsweredIntakeSource(source)) return "Booked on call"
  return "Entered by you"
}
