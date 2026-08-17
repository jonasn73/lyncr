/**
 * Send SMS to the owner for Amber — prefer Amber DID, fall back to business line.
 * New Amber numbers often aren't 10DLC-ready yet; the shop line usually is.
 * Verification codes prefer the business line first (carriers can lag after assign).
 */

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { sendTelnyxSms, type TelnyxSmsSendResult } from "@/lib/telnyx-sms"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"

type AmberSmsResult = TelnyxSmsSendResult & { used_from?: string }

function withAmberSaveNote(text: string, amber: string | null): string {
  if (!amber) return text
  return `${text} (Save ${formatPhoneDisplay(amber)} as Amber · Lyncr — this code text may come from your business line until Amber SMS is fully registered.)`
}

export async function sendAmberOwnerSms(params: {
  userId: string
  organizationId: string | null
  amberNumber: string | null
  toOwnerMobile: string
  text: string
  /** When true (verify codes), try the shop line first — more reliable than a new Amber DID. */
  preferBusinessLine?: boolean
  /** When true (coworker pings / SEND approval), never fall back to the shop line. */
  amberOnly?: boolean
}): Promise<AmberSmsResult> {
  const to = params.toOwnerMobile
  const amber = params.amberNumber?.trim() || null
  const preferBusiness = Boolean(params.preferBusinessLine)
  const amberOnly = Boolean(params.amberOnly)

  async function sendFromAmber(text: string): Promise<AmberSmsResult> {
    if (!amber) {
      return { ok: false, error: "No Amber number configured." }
    }
    const result = await sendTelnyxSms({
      toE164: to,
      fromE164: amber,
      text,
      userId: params.userId,
    })
    return { ...result, used_from: amber }
  }

  async function sendFromBusiness(text: string): Promise<AmberSmsResult> {
    const business = await resolveWorkspaceSmsSender(params.userId, params.organizationId)
    if (!business.ok) {
      return {
        ok: false,
        error: business.message || "No business line available to send the Amber code.",
      }
    }

    // Never use Amber as customer From — resolveWorkspaceSmsSender already skips Amber.
    if (amber && business.from_e164 === amber) {
      return {
        ok: false,
        error: "Could not find a non-Amber business line to send the verification text.",
      }
    }

    const result = await sendTelnyxSms({
      toE164: to,
      fromE164: business.from_e164,
      text: withAmberSaveNote(text, amber),
      userId: params.userId,
    })
    if (result.ok && result.delivery_warning) {
      return {
        ok: false,
        error: result.delivery_warning,
        errorType: "10DLC_BLOCK",
        used_from: result.from,
      }
    }
    return {
      ...result,
      used_from: result.ok ? result.from : business.from_e164,
    }
  }

  // Coworker pings must stay on the Amber DID so SEND replies hit the handler.
  if (amberOnly) {
    const only = await sendFromAmber(params.text)
    if (only.ok && only.delivery_warning) {
      return {
        ok: false,
        error: only.delivery_warning,
        errorType: "10DLC_BLOCK",
        used_from: amber ?? undefined,
      }
    }
    return only
  }

  // Verify / critical codes: shop line first (known working for lead alerts).
  if (preferBusiness) {
    const businessFirst = await sendFromBusiness(params.text)
    if (businessFirst.ok) return businessFirst

    console.warn("[amber-sms] Business From failed for preferBusinessLine; trying Amber", {
      amber,
      error: businessFirst.error,
    })
    if (amber) {
      const amberTry = await sendFromAmber(params.text)
      if (amberTry.ok && !amberTry.delivery_warning) return amberTry
    }
    return businessFirst
  }

  // Normal Amber replies: Amber first, then shop line.
  if (amber) {
    const fromAmber = await sendFromAmber(params.text)
    if (fromAmber.ok && !fromAmber.delivery_warning) {
      return fromAmber
    }
    console.warn("[amber-sms] Amber From failed or 10DLC warning; trying business line", {
      amber,
      ok: fromAmber.ok,
      warning: fromAmber.ok ? fromAmber.delivery_warning : fromAmber.error,
    })
  }

  const business = await sendFromBusiness(params.text)
  if (!business.ok && amber) {
    return sendFromAmber(params.text)
  }
  return business
}
