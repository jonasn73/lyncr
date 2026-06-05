// White-labeled Lyncr SMS that delivers a tech's secure /tech/setup link.

import {
  classifyTelnyxSmsError,
  is10DlcDeliveryWarning,
  sendTelnyxSms,
  TEN_DLC_BLOCK_USER_MESSAGE,
  type TelnyxSmsErrorType,
} from "@/lib/telnyx-sms"
import { toE164 } from "@/lib/phone-e164"
import { buildTechSetupUrl, techInviteSmsText } from "@/lib/tech-invite"

export type TechInviteSmsResult = {
  /** False when the text did not (or will not) reach the technician's phone. */
  success: boolean
  sent: boolean
  error: string | null
  errorType?: TelnyxSmsErrorType
  message?: string
  setupUrl: string
}

/** Resolve the public base URL for building the setup link (env first, request origin fallback). */
export function resolveAppBaseUrl(reqOrigin?: string | null): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/+$/, "")
  if (reqOrigin) return reqOrigin.replace(/\/+$/, "")
  return "https://lyncr.app"
}

/** Text a field tech their secure password-setup link. Never throws — returns a status object. */
export async function sendTechInviteSms(params: {
  ownerUserId: string
  toPhone: string
  businessName: string
  token: string
  baseUrl: string
}): Promise<TechInviteSmsResult> {
  const setupUrl = buildTechSetupUrl(params.baseUrl, params.token)
  try {
    const res = await sendTelnyxSms({
      toE164: toE164(params.toPhone),
      text: techInviteSmsText(params.businessName, setupUrl),
      userId: params.ownerUserId,
    })

    // Telnyx may return 200/202 while 10DLC is missing — treat that as a hard failure for invites.
    if (res.ok) {
      if (is10DlcDeliveryWarning(res.delivery_warning)) {
        console.error("[tech-invite-sms] 10DLC delivery block (accepted but not deliverable):", {
          to: params.toPhone,
          warning: res.delivery_warning,
        })
        return {
          success: false,
          sent: false,
          error: res.delivery_warning,
          errorType: "10DLC_BLOCK",
          message: TEN_DLC_BLOCK_USER_MESSAGE,
          setupUrl,
        }
      }
      return { success: true, sent: true, error: null, setupUrl }
    }

    const errorType = res.errorType ?? classifyTelnyxSmsError(res.error).errorType
    const message =
      errorType === "10DLC_BLOCK" ? TEN_DLC_BLOCK_USER_MESSAGE : res.error
    console.error("[tech-invite-sms] Telnyx send failed:", {
      to: params.toPhone,
      errorType,
      detail: res.error,
    })
    return { success: false, sent: false, error: res.error, errorType, message, setupUrl }
  } catch (e) {
    const errText = e instanceof Error ? e.message : "SMS failed"
    const classified = classifyTelnyxSmsError(errText)
    console.error("[tech-invite-sms] unexpected error:", { to: params.toPhone, detail: errText })
    return {
      success: false,
      sent: false,
      error: errText,
      errorType: classified.errorType,
      message: classified.message,
      setupUrl,
    }
  }
}
