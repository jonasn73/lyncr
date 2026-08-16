/**
 * Send SMS to the owner for Amber — prefer Amber DID, fall back to business line.
 * New Amber numbers often aren't 10DLC-ready yet; the shop line usually is.
 */

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { sendTelnyxSms, type TelnyxSmsSendResult } from "@/lib/telnyx-sms"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"

export async function sendAmberOwnerSms(params: {
  userId: string
  organizationId: string | null
  amberNumber: string | null
  toOwnerMobile: string
  text: string
}): Promise<TelnyxSmsSendResult & { used_from?: string }> {
  const to = params.toOwnerMobile
  const amber = params.amberNumber?.trim() || null

  if (amber) {
    const fromAmber = await sendTelnyxSms({
      toE164: to,
      fromE164: amber,
      text: params.text,
      userId: params.userId,
    })
    if (fromAmber.ok && !fromAmber.delivery_warning) {
      return { ...fromAmber, used_from: fromAmber.from }
    }
    // Soft-fail Amber From — try the customer-facing shop line next.
    console.warn("[amber-sms] Amber From failed or 10DLC warning; trying business line", {
      amber,
      ok: fromAmber.ok,
      warning: fromAmber.ok ? fromAmber.delivery_warning : fromAmber.error,
    })
  }

  const business = await resolveWorkspaceSmsSender(params.userId, params.organizationId)
  if (!business.ok) {
    if (amber) {
      // Last resort: return the Amber attempt result.
      const last = await sendTelnyxSms({
        toE164: to,
        fromE164: amber,
        text: params.text,
        userId: params.userId,
      })
      return { ...last, used_from: amber }
    }
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

  const note =
    amber != null
      ? ` (Save ${formatPhoneDisplay(amber)} as Amber · Lyncr — this code text may come from your business line until Amber SMS is fully registered.)`
      : ""

  const fromBusiness = await sendTelnyxSms({
    toE164: to,
    fromE164: business.from_e164,
    text: `${params.text}${note}`,
    userId: params.userId,
  })
  if (fromBusiness.ok && fromBusiness.delivery_warning) {
    return {
      ok: false,
      error: fromBusiness.delivery_warning,
      errorType: "10DLC_BLOCK",
      used_from: fromBusiness.from,
    }
  }
  return { ...fromBusiness, used_from: fromBusiness.ok ? fromBusiness.from : business.from_e164 }
}
