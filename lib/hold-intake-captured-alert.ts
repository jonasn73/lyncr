// One-time owner heads-up SMS when a hold-queue caller finishes answering the smart-hold
// intake questions (lib/hold-queue-intake-prompts.ts) — a real, qualified lead worth
// prioritizing, distinct from the time-based "still on hold" alert in
// lib/hold-long-wait-alert.ts. Same "lead alert" opt-in + recipient resolution as new-lead
// texts and the long-wait alert — not a second automated system to configure.

import { SITE_NAME } from "@/lib/brand"
import { getAppUrl } from "@/lib/telnyx"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { getOnboardingProfile, getUser } from "@/lib/db"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

function brandLabel(): string {
  const name = SITE_NAME.trim()
  if (!name) return "Lyncr"
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function buildHoldIntakeCapturedAlertText(params: {
  businessName: string
  callerE164: string | null
  summary: string
}): string {
  const caller = params.callerE164 ? formatPhoneDisplay(params.callerE164) : "Unknown number"
  let dashboardUrl = ""
  try {
    dashboardUrl = getAppUrl().replace(/\/$/, "")
  } catch {
    /* unit tests may lack NEXT_PUBLIC_APP_URL */
  }
  return [
    `📋 ${brandLabel()} — caller answered your questions`,
    `${caller} on hold for ${params.businessName}: ${params.summary}`,
    dashboardUrl ? `Answer from Lines: ${dashboardUrl}` : "Answer from Lines in your dashboard.",
    // Personal-cell calls are invisible to the platform — this reply is how the
    // owner stops the closed-hours no-response auto-text (sms-inbound-handler).
    "Calling them yourself? Reply HANDLED and we'll skip the auto follow-up text.",
  ].join("\n")
}

export type HoldIntakeCapturedAlertResult =
  | { ok: true; sent: boolean; to?: string }
  | { ok: false; error: string }

/** Fire once per call — the hold loop tracks `holdIntakeCapturedAlerted` so this never repeats. */
export async function sendHoldIntakeCapturedOwnerAlert(params: {
  userId: string
  callerE164: string | null
  summary: string
}): Promise<HoldIntakeCapturedAlertResult> {
  const userId = params.userId?.trim()
  const summary = params.summary?.trim()
  if (!userId || !summary) return { ok: true, sent: false }

  const [profile, user] = await Promise.all([getOnboardingProfile(userId), getUser(userId)])
  // Reuse the existing "text me about new leads" toggle — no separate setting to add.
  if (!profile?.sms_leads_enabled) return { ok: true, sent: false }

  const to = resolveLeadAlertSmsRecipient(profile, user)
  if (!to) return { ok: true, sent: false }

  const text = buildHoldIntakeCapturedAlertText({
    businessName: user?.business_name?.trim() || user?.name?.trim() || "your business",
    callerE164: params.callerE164,
    summary,
  })

  const sent = await sendTelnyxSms({ toE164: to, text, userId })
  if (!sent.ok) return { ok: false, error: sent.error }
  return { ok: true, sent: true, to }
}
