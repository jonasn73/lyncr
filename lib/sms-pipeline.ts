// ============================================
// Automated customer SMS pipeline (Lyncr Automated SMS Engine)
// ============================================
// Three phases — booking confirmation, technician en-route, and a post-job review request that drops
// 15 minutes after completion. Every send checks the owner's explicit toggle, renders their custom
// template with live job data, and goes out white-labeled (no infrastructure provider name exposed).

import { SITE_NAME } from "@/lib/brand"
import {
  claimScheduledSms,
  getLeadDispatchContext,
  getOwnerSmsSettings,
  getUser,
  insertScheduledSms,
  isReasonablePstnDialString,
  listDueScheduledSms,
  markScheduledSmsFailed,
  markScheduledSmsSent,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export type SmsPhase = "booking" | "route" | "review"

/** Minutes to wait before the post-job review text (overridable for testing). */
const REVIEW_DELAY_MIN = Math.max(0, Number(process.env.ZING_REVIEW_SMS_DELAY_MIN ?? 15) || 15)

function brandLabel(): string {
  const name = SITE_NAME.trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Lyncr"
}

/** Built-in copy used when the owner hasn't written a custom template. */
export function defaultTemplate(phase: SmsPhase): string {
  if (phase === "booking") {
    return "Hi {{customer_name}}, this is {{business_name}}. Your appointment is confirmed for {{time_slot}}. Reply here if anything changes."
  }
  if (phase === "route") {
    return "Hi {{customer_name}}, your {{business_name}} technician {{tech_name}} is on the way. See you soon!"
  }
  return "Thanks for choosing {{business_name}}, {{customer_name}}! We'd love your feedback — leave a quick review: {{review_url}}"
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
  | { ok: false; skipped: true; reason: string }

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
  const vars: Record<string, string> = {
    customer_name: ctx.customer_name?.trim() || "there",
    business_name: owner?.business_name?.trim() || brandLabel(),
    time_slot: ctx.time_slot?.trim() || "your scheduled time",
    tech_name: params.techName?.trim() || "your technician",
    review_url: settings.google_review_url?.trim() || "",
    location: ctx.location?.trim() || "",
  }

  const template =
    (settings[TEMPLATE_BY_PHASE[params.phase]] as string | null)?.trim() || defaultTemplate(params.phase)
  const body = renderTemplate(template, vars)
  if (!body) return { ok: false, skipped: true, reason: "empty-body" }

  // Review request drops later; everything else goes now.
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

  const res = await sendTelnyxSms({ toE164, text: body, userId: ctx.owner_user_id })
  if (!res.ok) {
    console.warn(`[sms-pipeline] ${params.phase} send failed: ${res.error}`)
    return { ok: false, skipped: true, reason: "send-failed" }
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
      const res = await sendTelnyxSms({ toE164: item.to_e164, text: item.body, userId: item.owner_user_id })
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
