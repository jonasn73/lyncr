// Shared SMS delivery for platform-admin operator onboarding invites.

import {
  formatPlatformSmsFailure,
  listPlatformSmsFromCandidates,
} from "@/lib/platform-sms-sender"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { configureNumberMessaging, isTelnyxOwnedNumber } from "@/lib/telnyx-messaging-config"

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

function isInvalidSmsSenderError(raw: string | undefined): boolean {
  if (!raw) return false
  const blob = raw.toLowerCase()
  return (
    blob.includes("40305") ||
    blob.includes("invalid 'from'") ||
    blob.includes("invalid source number") ||
    blob.includes("not on your telnyx messaging profile") ||
    blob.includes("could not enable messaging") ||
    blob.includes("messaging profile")
  )
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
  const text = `Hi ${firstName}! Lyncr invited you as a live operator. Tap to set up (expires in 48h): ${onboard_url}`

  const candidates = await listPlatformSmsFromCandidates()
  let lastError: string | undefined

  for (const from of candidates) {
    if (!(await isTelnyxOwnedNumber(from))) continue

    let smsResult = await sendTelnyxSms({
      toE164: params.phone,
      text,
      fromE164: from,
    })

    if (smsResult.ok) {
      return {
        onboard_url,
        phone_display,
        sms_sent: true,
        sms_error: smsResult.delivery_warning ?? undefined,
      }
    }

    lastError = smsResult.error
    if (!isInvalidSmsSenderError(smsResult.error)) break

    try {
      await configureNumberMessaging(from)
      smsResult = await sendTelnyxSms({
        toE164: params.phone,
        text,
        fromE164: from,
      })
      if (smsResult.ok) {
        return {
          onboard_url,
          phone_display,
          sms_sent: true,
          sms_error: smsResult.delivery_warning ?? undefined,
        }
      }
      lastError = smsResult.error
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }

    if (!isInvalidSmsSenderError(lastError)) break
  }

  return {
    onboard_url,
    phone_display,
    sms_sent: false,
    sms_error: formatPlatformSmsFailure(lastError),
  }
}
