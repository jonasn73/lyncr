// Owner SMS when Latest / recent activity needs attention (hot unreplied + review jobs).

import {
  getOnboardingProfile,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
  tryClaimLatestAttentionSmsSlot,
} from "@/lib/db"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

/** Hot Latest events that match isHotLatestAction / JustFinished semantics. */
export type LatestAttentionEvent = "replied" | "job_finished" | "book_form"

/** Cooldown for the same customer “replied” alert (ms). Jobs are once-only via dedupe key. */
export const LATEST_REPLIED_COOLDOWN_MS = 2 * 60 * 60 * 1000

export type NotifyLatestAttentionParams = {
  /** Business owner user id (onboarding_profiles.user_id). */
  userId: string
  /** Which Latest hot action triggered this. */
  event: LatestAttentionEvent
  /** Customer phone (E.164 preferred) — used in body + reply dedupe. */
  customerPhone?: string | null
  /** Optional display name for the SMS body. */
  customerName?: string | null
  /** Completed job id — required for job_finished dedupe. */
  jobId?: string | null
  /** Short inbound preview for replied alerts. */
  preview?: string | null
}

export type NotifyLatestAttentionResult =
  | { ok: true; sent: true; to: string }
  | { ok: true; sent: false; reason: string }
  | { ok: false; error: string }

/** Last 10 digits — stable key for the same US mobile across formatting. */
export function latestAttentionPhoneKey(phone: string | null | undefined): string {
  // Strip non-digits then keep the national last-10.
  return String(phone ?? "")
    .replace(/\D/g, "")
    .slice(-10)
}

/** Build the short owner reminder body (no PII beyond name/phone snippet). */
export function buildLatestAttentionSmsText(params: {
  event: LatestAttentionEvent
  customerPhone?: string | null
  customerName?: string | null
  preview?: string | null
}): string {
  // Dashboard deep-link so the owner can open Latest on their phone.
  const base = getAppUrl().replace(/\/+$/, "")
  const latestUrl = `${base}/dashboard`
  const who =
    (params.customerName || "").trim() ||
    formatPhoneDisplay(params.customerPhone || "") ||
    "a customer"

  if (params.event === "replied") {
    const preview = (params.preview || "").replace(/\s+/g, " ").trim()
    const snippet = preview ? ` “${preview.slice(0, 60)}${preview.length > 60 ? "…" : ""}”` : ""
    return `Lyncr Latest: ${who} replied and needs your attention.${snippet} Open: ${latestUrl}`
  }

  if (params.event === "book_form") {
    const preview = (params.preview || "").replace(/\s+/g, " ").trim()
    const line = preview || "Customer submitted book form"
    return `Lyncr Latest: ${line}${who !== "a customer" ? ` — ${who}` : ""}. Open: ${latestUrl}`
  }

  return `Lyncr Latest: Job finished for ${who} — send Thanks + review SMS. Open: ${latestUrl}`
}

/**
 * Send a Telnyx SMS to the owner when Latest needs attention.
 * Respects sms_latest_enabled, uses the same dispatch phone as lead alerts,
 * and rate-limits via latest_attention_sms_sent.
 */
export async function notifyOwnerLatestNeedsAttention(
  params: NotifyLatestAttentionParams
): Promise<NotifyLatestAttentionResult> {
  const userId = params.userId.trim()
  if (!userId) return { ok: true, sent: false, reason: "missing-user" }

  // Load profile + user for toggle + destination phone.
  const [profile, user] = await Promise.all([getOnboardingProfile(userId), getUser(userId)])

  // Owner must opt in under Settings → Business profile.
  if (!profile?.sms_latest_enabled) {
    return { ok: true, sent: false, reason: "disabled" }
  }

  // Same recipient resolution as instant lead alerts.
  const toE164 = resolveLeadAlertSmsRecipient(profile, user)
  if (!toE164) {
    return { ok: true, sent: false, reason: "no-owner-phone" }
  }

  // Never text the owner about a message that came from their own cell.
  const customerKey = latestAttentionPhoneKey(params.customerPhone)
  const ownerKey = latestAttentionPhoneKey(toE164)
  if (customerKey && ownerKey && customerKey === ownerKey) {
    return { ok: true, sent: false, reason: "self-phone" }
  }

  // Dedupe key: job/lead id (once) for finished + book form; phone for reply cooldown.
  const dedupeKey =
    params.event === "job_finished" || params.event === "book_form"
      ? String(params.jobId || "").trim() || customerKey || "unknown-job"
      : customerKey || "unknown-customer"

  if (!dedupeKey || dedupeKey === "unknown-job" || dedupeKey === "unknown-customer") {
    // Still allow send for edge cases, but prefer a real key when possible.
  }

  const cooldownMs = params.event === "replied" ? LATEST_REPLIED_COOLDOWN_MS : null
  const claimed = await tryClaimLatestAttentionSmsSlot({
    userId,
    eventType: params.event,
    dedupeKey: dedupeKey || `${params.event}-${Date.now()}`,
    cooldownMs,
  })
  if (!claimed) {
    return { ok: true, sent: false, reason: "rate-limited" }
  }

  const text = buildLatestAttentionSmsText({
    event: params.event,
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    preview: params.preview,
  })

  const sent = await sendTelnyxSms({ toE164, text, userId })
  if (!sent.ok) {
    console.warn("[latest-attention-sms] Telnyx send failed:", sent.error)
    return { ok: false, error: sent.error }
  }

  return { ok: true, sent: true, to: toE164 }
}

/** Normalize a free-typed US number to E.164 when checking “is this the owner?”. */
export function normalizeOwnerAlertPhone(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return null
  const e164 = normalizePhoneNumberE164(trimmed)
  return isReasonablePstnDialString(e164) ? e164 : null
}
