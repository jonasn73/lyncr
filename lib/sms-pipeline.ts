// ============================================
// Automated customer SMS pipeline (Lyncr Automated SMS Engine)
// ============================================
// Three phases — booking confirmation, technician en-route, and a post-job review request that drops
// 15 minutes after completion. Every send checks the owner's explicit toggle, renders their custom
// template with live job data, and goes out white-labeled (no infrastructure provider name exposed).

import { SITE_NAME } from "@/lib/brand"
import { DEFAULT_SMS_PHASE_TEMPLATES } from "@/lib/sms-template-defaults"
import {
  claimScheduledSms,
  getLeadDispatchContext,
  getOwnerSmsSettings,
  getUser,
  insertScheduledSms,
  isReasonablePstnDialString,
  listDueScheduledSms,
  markLeadReviewSmsSent,
  markScheduledSmsFailed,
  markScheduledSmsSent,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { createTrackedReviewUrl } from "@/lib/review-link-token"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"

export type SmsPhase = "booking" | "route" | "review"

/** Minutes to wait before the post-job review text (overridable for testing). */
const REVIEW_DELAY_MIN = Math.max(0, Number(process.env.ZING_REVIEW_SMS_DELAY_MIN ?? 15) || 15)

function brandLabel(): string {
  const name = SITE_NAME.trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Lyncr"
}

/** Built-in copy used when the owner hasn't written a custom template. */
export function defaultTemplate(phase: SmsPhase): string {
  return DEFAULT_SMS_PHASE_TEMPLATES[phase]
}

/** Replace {{tag}} tokens (case-insensitive); unknown tags collapse to empty. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) lower[k.toLowerCase()] = v
  return template
    .replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key: string) => lower[key.toLowerCase()] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export type PipelineResult =
  | { ok: true; sent: boolean; scheduled: boolean }
  | { ok: false; skipped: true; reason: string; detail?: string }

const TOGGLE_BY_PHASE: Record<SmsPhase, keyof Awaited<ReturnType<typeof getOwnerSmsSettings>>> = {
  booking: "sms_booking_enabled",
  route: "sms_route_enabled",
  review: "sms_review_enabled",
}

const TEMPLATE_BY_PHASE: Record<SmsPhase, keyof Awaited<ReturnType<typeof getOwnerSmsSettings>>> = {
  booking: "sms_booking_template",
  route: "sms_route_template",
  review: "sms_review_template",
}

/**
 * Run one phase of the customer SMS pipeline for a job.
 * Booking + route send immediately; review is scheduled ~15 min out.
 */
export async function runSmsPipeline(params: {
  leadId: string
  phase: SmsPhase
  techName?: string | null
  /** Restrict to a specific owner (authorization guard for the HTTP endpoint). */
  expectedOwnerUserId?: string
}): Promise<PipelineResult> {
  const ctx = await getLeadDispatchContext(params.leadId)
  if (!ctx) return { ok: false, skipped: true, reason: "lead-not-found" }
  if (params.expectedOwnerUserId && ctx.owner_user_id !== params.expectedOwnerUserId) {
    return { ok: false, skipped: true, reason: "owner-mismatch" }
  }

  const settings = await getOwnerSmsSettings(ctx.owner_user_id)
  if (settings[TOGGLE_BY_PHASE[params.phase]] !== true) {
    return { ok: false, skipped: true, reason: "phase-disabled" }
  }

  const toE164 = ctx.customer_phone ? normalizePhoneNumberE164(ctx.customer_phone) : ""
  if (!isReasonablePstnDialString(toE164)) {
    return { ok: false, skipped: true, reason: "no-customer-phone" }
  }

  if (params.phase === "review" && !settings.google_review_url?.trim()) {
    return { ok: false, skipped: true, reason: "no-review-url" }
  }

  const owner = await getUser(ctx.owner_user_id)
  let reviewUrl = settings.google_review_url?.trim() || ""
  if (params.phase === "review" && reviewUrl) {
    reviewUrl =
      (await createTrackedReviewUrl({
        ownerUserId: ctx.owner_user_id,
        destinationUrl: reviewUrl,
        leadId: ctx.lead_id,
        customerPhone: toE164,
      })) || reviewUrl
  }

  const vars: Record<string, string> = {
    customer_name: ctx.customer_name?.trim() || "there",
    business_name: owner?.business_name?.trim() || brandLabel(),
    time_slot: ctx.time_slot?.trim() || "",
    tech_name: params.techName?.trim() || "your technician",
    review_url: reviewUrl,
    location: ctx.location?.trim() || "",
  }

  const template =
    (settings[TEMPLATE_BY_PHASE[params.phase]] as string | null)?.trim() || defaultTemplate(params.phase)
  const body = renderTemplate(template, vars)
  if (!body) return { ok: false, skipped: true, reason: "empty-body" }

  // Booking confirm uses the same Follow-up template as intake / leftover cover — skip a second copy.
  if (params.phase === "booking") {
    const { wouldDuplicateRecentCustomerSms } = await import("@/lib/booking-sms-guards")
    if (
      await wouldDuplicateRecentCustomerSms({
        ownerUserId: ctx.owner_user_id,
        customerPhone: toE164,
        candidateText: body,
      })
    ) {
      return { ok: true, sent: false, scheduled: false }
    }
  }

  // Review request drops later; everything else goes now (and is logged for delivery tracking).
  if (params.phase === "review") {
    const sendAfter = new Date(Date.now() + REVIEW_DELAY_MIN * 60_000)
    await insertScheduledSms({
      owner_user_id: ctx.owner_user_id,
      lead_id: ctx.lead_id,
      to_e164: toE164,
      body,
      phase: "review",
      send_after: sendAfter,
    })
    return { ok: true, sent: false, scheduled: true }
  }

  const res = await sendAndLogWorkspaceCustomerSms({
    ownerUserId: ctx.owner_user_id,
    toE164,
    text: body,
    organizationId: ctx.organization_id,
  })
  if (!res.ok) {
    console.warn(`[sms-pipeline] ${params.phase} send failed: ${res.error}`)
    return { ok: false, skipped: true, reason: "send-failed", detail: res.error }
  }
  return { ok: true, sent: true, scheduled: false }
}

/**
 * Centralized job-state → customer-SMS subscriber. Maps a job lifecycle event to its SMS phase and
 * runs the toggle-gated pipeline:
 *   BOOKED    → booking confirmation (immediate)
 *   EN_ROUTE  → "technician on the way" (immediate)
 *   COMPLETED → post-job review request (scheduled ~15 min out)
 */
export type JobStateEvent = "BOOKED" | "EN_ROUTE" | "COMPLETED"

const PHASE_BY_EVENT: Record<JobStateEvent, SmsPhase> = {
  BOOKED: "booking",
  EN_ROUTE: "route",
  COMPLETED: "review",
}

export async function onJobStateChange(
  event: JobStateEvent,
  params: { leadId: string; techName?: string | null; expectedOwnerUserId?: string }
): Promise<PipelineResult> {
  const phase = PHASE_BY_EVENT[event]
  if (!phase) return { ok: false, skipped: true, reason: "unknown-event" }
  return runSmsPipeline({
    leadId: params.leadId,
    phase,
    techName: params.techName,
    expectedOwnerUserId: params.expectedOwnerUserId,
  })
}

/**
 * Owner tapped “Thanks + review” on Today / Collect — send now.
 * Ignores the auto-review toggle (explicit action) but still needs a review URL when one is configured;
 * if the URL is missing, sends a plain thank-you without a link.
 */
export async function sendManualThanksReviewSms(params: {
  leadId: string
  techName?: string | null
  expectedOwnerUserId?: string
}): Promise<PipelineResult> {
  const ctx = await getLeadDispatchContext(params.leadId)
  if (!ctx) return { ok: false, skipped: true, reason: "lead-not-found" }
  if (params.expectedOwnerUserId && ctx.owner_user_id !== params.expectedOwnerUserId) {
    return { ok: false, skipped: true, reason: "owner-mismatch" }
  }

  const toE164 = ctx.customer_phone ? normalizePhoneNumberE164(ctx.customer_phone) : ""
  if (!isReasonablePstnDialString(toE164)) {
    return { ok: false, skipped: true, reason: "no-customer-phone" }
  }

  const settings = await getOwnerSmsSettings(ctx.owner_user_id)
  const owner = await getUser(ctx.owner_user_id)
  let reviewUrl = settings.google_review_url?.trim() || ""
  if (reviewUrl) {
    reviewUrl =
      (await createTrackedReviewUrl({
        ownerUserId: ctx.owner_user_id,
        destinationUrl: reviewUrl,
        leadId: ctx.lead_id,
        customerPhone: toE164,
      })) || reviewUrl
  }
  const vars: Record<string, string> = {
    customer_name: ctx.customer_name?.trim() || "there",
    business_name: owner?.business_name?.trim() || brandLabel(),
    time_slot: ctx.time_slot?.trim() || "",
    tech_name: params.techName?.trim() || "your technician",
    review_url: reviewUrl,
    location: ctx.location?.trim() || "",
  }

  // Always use the owner’s saved review wording (Today “Texts” / SMS templates).
  // If they left {{review_url}} in place but have no link yet, strip the empty tag cleanly.
  const template =
    settings.sms_review_template?.trim() ||
    (reviewUrl
      ? defaultTemplate("review")
      : "Hey {{customer_name}} — thanks for choosing {{business_name}}.")
  const body = renderTemplate(template, vars)
    .replace(/\s+/g, " ")
    .replace(/\s+:/g, ":")
    .trim()
  if (!body) return { ok: false, skipped: true, reason: "empty-body" }

  // Log into Messages so delivery receipts (Delivered / Failed) attach to this text.
  // Always pass the job's organization so we send from Key Squad (not another shop's line).
  const res = await sendAndLogWorkspaceCustomerSms({
    ownerUserId: ctx.owner_user_id,
    toE164,
    text: body,
    organizationId: ctx.organization_id,
  })
  if (!res.ok) {
    console.warn(`[sms-pipeline] manual review send failed: ${res.error}`)
    return { ok: false, skipped: true, reason: "send-failed", detail: res.error }
  }
  // Always stamp the job so Latest shows “sent” even if the inbox row insert is missing.
  await markLeadReviewSmsSent({
    leadId: ctx.lead_id,
    ownerUserId: ctx.owner_user_id,
    telnyxMessageId: res.message_id,
  }).catch((e) => {
    console.warn("[sms-pipeline] markLeadReviewSmsSent failed:", e)
  })
  if (!res.message) {
    console.warn(
      `[sms-pipeline] review SMS sent via Telnyx (${res.message_id || "no-id"}) but sms_messages insert returned null`
    )
  }
  return { ok: true, sent: true, scheduled: false }
}

/**
 * Send any scheduled texts that are now due. Called by the cron flush endpoint AND opportunistically
 * from frequently-polled dashboards, so review texts go out within minutes even without a cron.
 */
export async function flushDueScheduledSms(limit = 20): Promise<{ sent: number; failed: number }> {
  const due = await listDueScheduledSms(limit)
  let sent = 0
  let failed = 0
  for (const item of due) {
    // Claim first so two concurrent flushers never double-send.
    const claimed = await claimScheduledSms(item.id)
    if (!claimed) continue
    try {
      // Resolve the job's workspace so we don't send from another shop's line.
      let organizationId: string | null = null
      if (item.lead_id) {
        const ctx = await getLeadDispatchContext(item.lead_id)
        organizationId = ctx?.organization_id ?? null
      }
      const res = await sendAndLogWorkspaceCustomerSms({
        ownerUserId: item.owner_user_id,
        toE164: item.to_e164,
        text: item.body,
        organizationId,
      })
      if (res.ok) {
        await markScheduledSmsSent(item.id)
        sent++
      } else {
        await markScheduledSmsFailed(item.id, res.error)
        failed++
      }
    } catch (e) {
      await markScheduledSmsFailed(item.id, e instanceof Error ? e.message : String(e))
      failed++
    }
  }
  return { sent, failed }
}
