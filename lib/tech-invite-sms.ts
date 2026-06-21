// White-labeled Lyncr SMS that delivers a tech's secure /tech/setup link.

import {
  classifyTelnyxSmsError,
  is10DlcDeliveryWarning,
  sendTelnyxSms,
  TEN_DLC_BLOCK_USER_MESSAGE,
} from "@/lib/telnyx-sms"
import { toE164 } from "@/lib/phone-e164"
import { buildTechSetupUrl, techInviteSmsText } from "@/lib/tech-invite"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"

import type { TechInviteSmsErrorType } from "@/lib/tech-invite-sms-types"

export type TechInviteSmsResult = {
  /** False when the text did not (or will not) reach the technician's phone. */
  success: boolean
  sent: boolean
  error: string | null
  errorType?: TechInviteSmsErrorType
  message?: string
  setupUrl: string
  /** E.164 we attempted (or would use) for this workspace. */
  from_e164?: string | null
}

function mapSenderBlockReason(
  reason: "porting" | "no_line" | "invalid_line"
): TechInviteSmsErrorType {
  if (reason === "porting") return "PORTING"
  if (reason === "no_line") return "NO_SMS_LINE"
  return "INVALID_SENDER"
}

function mapTelnyxFailure(raw: string): { errorType: TechInviteSmsErrorType; message: string } {
  const classified = classifyTelnyxSmsError(raw)
  if (classified.errorType === "10DLC_BLOCK") {
    return { errorType: "10DLC_BLOCK", message: TEN_DLC_BLOCK_USER_MESSAGE }
  }
  const blob = raw.toLowerCase()
  if (/invalid source number|invalid 'from'|40305/.test(blob)) {
    return {
      errorType: "INVALID_SENDER",
      message:
        "This workspace's business line is not set up for outbound SMS on Telnyx yet. Finish the line under Settings → Lines, or share the setup link manually.",
    }
  }
  return { errorType: "OTHER", message: classified.message }
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
  organizationId?: string | null
  toPhone: string
  businessName: string
  token: string
  baseUrl: string
}): Promise<TechInviteSmsResult> {
  const setupUrl = buildTechSetupUrl(params.baseUrl, params.token)

  const sender = await resolveWorkspaceSmsSender(params.ownerUserId, params.organizationId)
  if (!sender.ok) {
    return {
      success: false,
      sent: false,
      error: sender.message,
      errorType: mapSenderBlockReason(sender.reason),
      message: sender.message,
      setupUrl,
      from_e164: sender.intended_number,
    }
  }

  try {
    const res = await sendTelnyxSms({
      toE164: toE164(params.toPhone),
      text: techInviteSmsText(params.businessName, setupUrl),
      userId: params.ownerUserId,
      fromE164: sender.from_e164,
    })

    if (res.ok) {
      if (is10DlcDeliveryWarning(res.delivery_warning)) {
        console.error("[tech-invite-sms] 10DLC delivery block (accepted but not deliverable):", {
          to: params.toPhone,
          from: sender.from_e164,
          warning: res.delivery_warning,
        })
        return {
          success: false,
          sent: false,
          error: res.delivery_warning,
          errorType: "10DLC_BLOCK",
          message: TEN_DLC_BLOCK_USER_MESSAGE,
          setupUrl,
          from_e164: sender.from_e164,
        }
      }
      return { success: true, sent: true, error: null, setupUrl, from_e164: sender.from_e164 }
    }

    const mapped = mapTelnyxFailure(res.error)
    console.error("[tech-invite-sms] Telnyx send failed:", {
      to: params.toPhone,
      from: sender.from_e164,
      errorType: mapped.errorType,
      detail: res.error,
    })
    return {
      success: false,
      sent: false,
      error: res.error,
      errorType: mapped.errorType,
      message: mapped.message,
      setupUrl,
      from_e164: sender.from_e164,
    }
  } catch (e) {
    const errText = e instanceof Error ? e.message : "SMS failed"
    const mapped = mapTelnyxFailure(errText)
    console.error("[tech-invite-sms] unexpected error:", {
      to: params.toPhone,
      from: sender.from_e164,
      detail: errText,
    })
    return {
      success: false,
      sent: false,
      error: errText,
      errorType: mapped.errorType,
      message: mapped.message,
      setupUrl,
      from_e164: sender.from_e164,
    }
  }
}
