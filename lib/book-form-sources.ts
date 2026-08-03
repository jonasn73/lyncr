// Client-safe book-form source helpers (no DB / Twilio / SMS imports).
// Used by CRM UI + server intake paths to label customer-filled vs operator-entered leads.

/** Intake sources that mean the customer submitted a book / callback form. */
export const BOOK_FORM_INTAKE_SOURCES = new Set([
  "public_book_asap",
  "public_book_window",
  "public_book",
  "activity_book_link",
])

/** True when collected.source is a public /book or Activity book-link submission. */
export function isBookFormIntakeSource(source: string | null | undefined): boolean {
  const s = (source || "").trim()
  return BOOK_FORM_INTAKE_SOURCES.has(s)
}

/** CRM badge copy — customer book link vs operator intake. */
export function crmIntakeFilledByLabel(
  source: string | null | undefined
): "Filled by customer" | "Entered by you" {
  return isBookFormIntakeSource(source) ? "Filled by customer" : "Entered by you"
}
