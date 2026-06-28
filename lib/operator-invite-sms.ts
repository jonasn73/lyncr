// Shared SMS delivery for platform-admin operator onboarding invites.

import { resolvePlatformSmsFromE164 } from "@/lib/platform-sms-sender"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

export function formatOperatorPhoneDisplay(e164: string): string {
  const d = e164.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return e164
}

export function buildOperatorOnboardUrl(token: string): string {
  const appUrl = getAppUrl().replace(/\/$/, "")
  return `${appUrl}/auth/onboard?token=${encodeURIComponent(token)}`
}

export async function deliverOperatorInviteSms(params: {
  phone: string
  name: string
  token: string
}): Promise<{
  onboard_url: string
  phone_display: string
  sms_sent: boolean
  sms_error?: string
}> {
  const onboard_url = buildOperatorOnboardUrl(params.token)
  const firstName = params.name.split(/\s+/)[0] || "there"
  const phone_display = formatOperatorPhoneDisplay(params.phone)

  const sender = await resolvePlatformSmsFromE164()
  if (!sender.ok) {
    return { onboard_url, phone_display, sms_sent: false, sms_error: sender.message }
  }

  const smsResult = await sendTelnyxSms({
    toE164: params.phone,
    text: `Hi ${firstName}! Lyncr invited you as a live operator. Tap to set up (expires in 48h): ${onboard_url}`,
    fromE164: sender.from_e164,
  })

  return {
    onboard_url,
    phone_display,
    sms_sent: smsResult.ok,
    sms_error: smsResult.ok ? smsResult.delivery_warning ?? undefined : smsResult.error,
  }
}
