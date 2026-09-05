// One-time owner heads-up SMS when a caller has been on the Busy hold queue a while.
// Same "lead alert" opt-in + recipient resolution as new-lead texts — this is not a
// second automated system to configure, just another reason the same toggle fires.

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

function buildHoldLongWaitAlertText(params: {
  businessName: string
  callerE164: string | null
  waitedSecs: number
}): string {
  const minutes = Math.max(1, Math.round(params.waitedSecs / 60))
  const caller = params.callerE164 ? formatPhoneDisplay(params.callerE164) : "Unknown number"
  let dashboardUrl = ""
  try {
    dashboardUrl = getAppUrl().replace(/\/$/, "")
  } catch {
    /* unit tests may lack NEXT_PUBLIC_APP_URL */
  }
  return [
    `⏳ ${brandLabel()} — still on hold`,
    `${caller} has been waiting ${minutes} min${minutes === 1 ? "" : "s"} for ${params.businessName} and hasn't hung up.`,
    dashboardUrl ? `Answer from Lines: ${dashboardUrl}` : "Answer from Lines in your dashboard.",
  ].join("\n")
}

export type HoldLongWaitAlertResult = { ok: true; sent: boolean; to?: string } | { ok: false; error: string }

/** Fire once per call — the hold loop tracks `holdLongWaitAlerted` so this never repeats. */
export async function sendHoldLongWaitOwnerAlert(params: {
  userId: string
  callerE164: string | null
  waitedSecs: number
}): Promise<HoldLongWaitAlertResult> {
  const userId = params.userId?.trim()
  if (!userId) return { ok: true, sent: false }

  const [profile, user] = await Promise.all([getOnboardingProfile(userId), getUser(userId)])
  // Reuse the existing "text me about new leads" toggle — no separate setting to add.
  if (!profile?.sms_leads_enabled) return { ok: true, sent: false }

  const to = resolveLeadAlertSmsRecipient(profile, user)
  if (!to) return { ok: true, sent: false }

  const text = buildHoldLongWaitAlertText({
    businessName: user?.business_name?.trim() || user?.name?.trim() || "your business",
    callerE164: params.callerE164,
    waitedSecs: params.waitedSecs,
  })

  const sent = await sendTelnyxSms({ toE164: to, text, userId })
  if (!sent.ok) return { ok: false, error: sent.error }
  return { ok: true, sent: true, to }
}
