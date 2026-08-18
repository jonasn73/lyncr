// One-tap callback outcomes + “couldn’t reach you” SMS after dialing a book-form lead.

import {
  CRM_LEAD_STATUS,
  LOST_LEAD_STATUS,
  UNASSIGNED_CALLBACK_STATUS,
  UNASSIGNED_POOL_STATUS,
} from "@/lib/job-pool"

/** Cooldown for the same unreachable template (minutes). */
export const UNREACHABLE_SMS_COOLDOWN_MINUTES = 45

/** CRM callback outcomes stored on ai_leads.collected.callback_outcome. */
export type LeadCallbackOutcome = "called_no_answer" | "called_answered"

/** Badge tone used on CRM list + profile job status chips. */
export type CrmStatusTone = "neutral" | "amber" | "emerald" | "rose" | "sky"

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
  const base = `Hey ${who} — we tried calling and didn’t catch you. Text us here for any update or change. — ${shop}`
  return link ? `${base} ${link}` : base
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

/**
 * Human job status for CRM list rows + service history.
 * Same glossary everywhere: Needs call → Called · … → Booked · time → Complete.
 */
export function resolveCrmJobStatusPresentation(params: {
  dispatchStatus?: string | null
  jobStatus?: string | null
  scheduledAt?: string | null
  callbackOutcome?: LeadCallbackOutcome | null
  /** Open lead with a stored quote — show “Price quoted” instead of plain Needs call. */
  hasQuotedPrice?: boolean
}): {
  status_label: string
  status_tone: CrmStatusTone
  is_open_lead: boolean
  is_salvageable: boolean
} {
  // Normalize writers (job_status / dispatch_status) to lowercase for comparisons.
  const ds = String(params.dispatchStatus ?? "")
    .trim()
    .toLowerCase()
  const js = String(params.jobStatus ?? "")
    .trim()
    .toLowerCase()
  const scheduledAt = String(params.scheduledAt ?? "").trim() || null
  const outcome = params.callbackOutcome ?? null
  const calledAnswered = outcome === "called_answered"
  const calledNoAnswer = outcome === "called_no_answer"

  // Salvage / price-rejected lanes — before “booked” so stale scheduled_at does not win.
  const isSalvageLead =
    ds === "salvage_pending" ||
    ds === LOST_LEAD_STATUS ||
    js === "price_denied" ||
    js === "price_rejected" ||
    js.includes("price")

  // Terminal job_status values — never treat as open CRM leads.
  const isTerminalJs =
    js === "completed" ||
    js === "done" ||
    js === "paid" ||
    js === "cancelled" ||
    js === "canceled" ||
    js === "unresolved" ||
    js === "referred"

  const isOpenLead =
    !isTerminalJs &&
    (ds === CRM_LEAD_STATUS ||
      ds === LOST_LEAD_STATUS ||
      ds === UNASSIGNED_CALLBACK_STATUS ||
      ds === "salvage_pending" ||
      js.includes("price"))

  let status_label = "Job"
  let status_tone: CrmStatusTone = "neutral"

  if (js === "completed" || js === "done" || js === "paid" || ds === "completed") {
    status_label = "Complete"
    status_tone = "emerald"
  } else if (js === "cancelled" || js === "canceled" || ds === "cancelled" || ds === "canceled") {
    status_label = "Cancelled"
    status_tone = "neutral"
  } else if (js === "referred" || ds === "referred") {
    status_label = "Referred"
    status_tone = "neutral"
  } else if (js === "unresolved" || ds === "unresolved") {
    status_label = "Unresolved"
    status_tone = "neutral"
  } else if (js === "en_route") {
    status_label = "En route"
    status_tone = "sky"
  } else if (js === "arrived" || js === "on_site") {
    status_label = "On site"
    status_tone = "sky"
  } else if (js === "paused_wait" || js === "paused_parts") {
    status_label = "Paused"
    status_tone = "amber"
  } else if (isSalvageLead) {
    status_label =
      ds === LOST_LEAD_STATUS || ds === "salvage_pending" ? "Needs recovery" : "Price rejected"
    status_tone = "rose"
  } else if (ds === UNASSIGNED_POOL_STATUS && !scheduledAt) {
    status_label = "In pool"
    status_tone = "amber"
  } else if (ds === "dispatched" || Boolean(scheduledAt)) {
    // Prefer “Booked · {time}” when we have an appointment window.
    status_label = scheduledAt ? formatCrmBookedStatusLabel(scheduledAt) : "Booked"
    status_tone = "sky"
  } else if (
    (ds === CRM_LEAD_STATUS || ds === UNASSIGNED_CALLBACK_STATUS) &&
    calledAnswered
  ) {
    status_label = "Called · answered"
    status_tone = "sky"
  } else if (
    (ds === CRM_LEAD_STATUS || ds === UNASSIGNED_CALLBACK_STATUS) &&
    calledNoAnswer
  ) {
    status_label = "Called · no answer"
    status_tone = "amber"
  } else if (ds === CRM_LEAD_STATUS || ds === UNASSIGNED_CALLBACK_STATUS) {
    // Quoted open leads read better as “Price quoted” than bare “Needs call”.
    if (params.hasQuotedPrice) {
      status_label = "Price quoted"
      status_tone = "amber"
    } else {
      status_label = "Needs call"
      status_tone = "amber"
    }
  }

  return {
    status_label,
    status_tone,
    is_open_lead: isOpenLead,
    is_salvageable: isSalvageLead && isOpenLead,
  }
}

/**
 * Secondary meta under a CRM list name — status first, then open/job counts.
 * Example: “Needs call · 1 open” or “Complete · 2 jobs”.
 */
export function formatCrmListRowMeta(params: {
  statusLabel?: string | null
  openLeadCount: number
  jobsCompleted: number
}): string {
  const status = String(params.statusLabel ?? "").trim()
  const open = Math.max(0, Number(params.openLeadCount) || 0)
  const done = Math.max(0, Number(params.jobsCompleted) || 0)
  const parts: string[] = []

  if (status) {
    // Lead with the useful lifecycle badge (Needs call, Booked · time, Complete, …).
    parts.push(status)
  } else if (done > 0) {
    // No status from leads — fall back to completed job count.
    parts.push(`${done} job${done === 1 ? "" : "s"}`)
  } else {
    parts.push("No jobs yet")
  }

  if (open > 0) {
    // Keep open count when useful (“1 open”) after the status.
    parts.push(`${open} open`)
  } else if (status && done > 1) {
    // Booked / complete clients with multiple jobs — show the count after status.
    parts.push(`${done} jobs`)
  }

  return parts.join(" · ")
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
