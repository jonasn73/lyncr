// One-tap callback outcomes + “couldn’t reach you” SMS after dialing a book-form lead.

/** Cooldown for the same unreachable template (minutes). */
export const UNREACHABLE_SMS_COOLDOWN_MINUTES = 45

/** CRM callback outcomes stored on ai_leads.collected.callback_outcome. */
export type LeadCallbackOutcome = "called_no_answer" | "called_answered"

/**
 * Default customer text when a tech called and got no answer.
 * Uses the business name from the tenant (falls back to “our team”).
 */
export function buildUnreachableFollowUpSms(params: {
  customerName?: string | null
  businessName?: string | null
  /** Optional short book / reply link. */
  shortLink?: string | null
}): string {
  const first = String(params.customerName ?? "")
    .trim()
    .split(/\s+/)[0]
  const who = first || "there"
  const shop =
    String(params.businessName ?? "")
      .trim()
      .replace(/\s+/g, " ") || "our team"
  const link = String(params.shortLink ?? "").trim()
  const base = `Hi ${who}, a technician from ${shop} called and couldn’t reach you. Reply here or book`
  return link ? `${base}: ${link}` : `${base}.`
}

/** Normalize callback_outcome from collected JSON. */
export function leadCallbackOutcomeFromCollected(
  collected: Record<string, unknown> | null | undefined
): LeadCallbackOutcome | null {
  if (!collected) return null
  const outcome = String(collected.callback_outcome ?? "")
    .trim()
    .toLowerCase()
  if (outcome === "called_answered") return "called_answered"
  if (outcome === "called_no_answer") return "called_no_answer"
  // Legacy stamps before callback_outcome was always set.
  if (String(collected.called_answered_at ?? "").trim()) return "called_answered"
  if (String(collected.called_no_answer_at ?? "").trim()) return "called_no_answer"
  return null
}

/** True when CRM should show “Called · no answer” for an open lead. */
export function isCalledNoAnswerOutcome(collected: Record<string, unknown> | null | undefined): boolean {
  return leadCallbackOutcomeFromCollected(collected) === "called_no_answer"
}

/** True when CRM should show “Called · answered”. */
export function isCalledAnsweredOutcome(collected: Record<string, unknown> | null | undefined): boolean {
  return leadCallbackOutcomeFromCollected(collected) === "called_answered"
}

/** Human badge for a callback outcome. */
export function crmCallbackOutcomeLabel(outcome: LeadCallbackOutcome): string {
  return outcome === "called_answered" ? "Called · answered" : "Called · no answer"
}

/** Short appointment label for CRM badges — “Booked · Aug 9, 7:30 PM”. */
export function formatCrmBookedStatusLabel(scheduledAtIso: string): string {
  const d = new Date(scheduledAtIso)
  if (Number.isNaN(d.getTime())) return "Booked"
  const when = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return `Booked · ${when}`
}

/** True when CRM status is still in the call / open-lead phase (not booked yet). */
export function isCrmPreBookStatusLabel(statusLabel: string): boolean {
  const label = String(statusLabel ?? "").trim()
  return (
    label === "Needs call" ||
    label === "Called · no answer" ||
    label === "Called · answered"
  )
}

/** True when CRM status is Booked (with or without appointment time). */
export function isCrmBookedStatusLabel(statusLabel: string): boolean {
  const label = String(statusLabel ?? "").trim()
  return label === "Booked" || label.startsWith("Booked ·")
}

/** True when CRM status is a terminal close-out. */
export function isCrmTerminalStatusLabel(statusLabel: string): boolean {
  const label = String(statusLabel ?? "").trim()
  return (
    label === "Complete" ||
    label === "Done" ||
    label === "Completed" ||
    label === "Cancelled" ||
    label === "Referred" ||
    label === "Unresolved"
  )
}

/**
 * Show the Submitted request / job lifecycle card for this history row.
 * Open leads, booked/active jobs, and cancelled/complete close-outs stay editable.
 */
export function shouldShowCrmLifecycleCard(params: {
  isOpenLead: boolean
  statusLabel: string
  navAction: "Book job" | "Open job" | "View job" | "Recover" | null
}): boolean {
  if (params.isOpenLead) return true
  if (params.navAction === "Open job" || params.navAction === "Recover") return true
  if (isCrmBookedStatusLabel(params.statusLabel)) return true
  if (isCrmTerminalStatusLabel(params.statusLabel)) return true
  return false
}
