// ============================================
// Mobile operator voice wrap-up callback trigger
// ============================================
// After a mobile operator's bridged call ends, place an outbound TeXML callback that runs the
// hands-free wrap-up IVR (/api/voice/telnyx/wrapup). The operator becomes the controlling leg on
// that outbound call, so Gather + Record work cleanly (unlike the original inbound bridge where the
// operator is the B-leg and can't be prompted after the customer hangs up).
//
// Fully inert unless a TeXML connection id is configured AND the receptionist is flagged
// is_mobile_operator — the post-call outcome-code SMS (lib/post-call-disposition-sms) stays as the
// always-on fallback for everyone else.

import { getAppUrl } from "@/lib/telnyx"
import {
  getReceptionistIsMobileOperator,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { isTexmlOutboundConfigured, placeTexmlOutboundCall } from "@/lib/telnyx-outbound-call"

export async function maybePlaceMobileWrapupCallback(params: {
  userId: string
  receptionistId: string | null | undefined
  receptionistPhoneRaw: string | null | undefined
  businessLineE164: string | null | undefined
  businessName: string | null | undefined
  callSid: string
}): Promise<void> {
  if (!isTexmlOutboundConfigured()) return
  const receptionistId = params.receptionistId?.trim()
  if (!receptionistId || !params.callSid.trim()) return

  const cell = normalizePhoneNumberE164(params.receptionistPhoneRaw || "")
  if (!isReasonablePstnDialString(cell)) return
  const from = normalizePhoneNumberE164(params.businessLineE164 || "")
  if (!isReasonablePstnDialString(from)) return

  if (!(await getReceptionistIsMobileOperator(receptionistId))) return

  const qs = new URLSearchParams()
  qs.set("cl", params.callSid)
  qs.set("u", params.userId)
  qs.set("r", receptionistId)
  if (params.businessName?.trim()) qs.set("bn", params.businessName.trim())
  const url = `${getAppUrl().replace(/\/+$/, "")}/api/voice/telnyx/wrapup?${qs.toString()}`

  const res = await placeTexmlOutboundCall({ toE164: cell, fromE164: from, url })
  if (res.ok) {
    console.log(
      JSON.stringify({ lyncr: "mobile-wrapup-callback-placed", userId: params.userId, callSid: params.callSid })
    )
  } else if (!res.skipped) {
    console.error(`[wrapup-callback] failed to place callback: ${res.error}`)
  }
}
