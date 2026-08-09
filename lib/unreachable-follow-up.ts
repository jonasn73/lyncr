// One-tap “couldn’t reach you” SMS after calling a submitted book-form lead.

/** Cooldown for the same unreachable template (minutes). */
export const UNREACHABLE_SMS_COOLDOWN_MINUTES = 45

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

/** True when CRM should show “Called · no answer” for an open lead. */
export function isCalledNoAnswerOutcome(collected: Record<string, unknown> | null | undefined): boolean {
  if (!collected) return false
  const outcome = String(collected.callback_outcome ?? "")
    .trim()
    .toLowerCase()
  if (outcome === "called_no_answer") return true
  return Boolean(String(collected.called_no_answer_at ?? "").trim())
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
