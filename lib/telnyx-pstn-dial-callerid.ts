import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"

/**
 * Outbound PSTN `<Dial callerId>` for forwarding inbound calls.
 * Default: show the **original caller** on the teammate’s phone.
 * Set `ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE=1` to show the **business / carrier-safe** number instead (previous behavior).
 */
export function resolvePstnDialCallerIdForInboundForward(opts: {
  inboundFromRaw: string
  businessOutboundE164: string
}): string {
  const useBusinessLine = ["1", "true", "yes", "on"].includes(
    (process.env.ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE || "").trim().toLowerCase()
  )
  const biz = opts.businessOutboundE164.trim() ? normalizePhoneNumberE164(opts.businessOutboundE164) : ""
  const from = opts.inboundFromRaw.trim() ? normalizePhoneNumberE164(opts.inboundFromRaw) : ""
  if (useBusinessLine && isReasonablePstnDialString(biz)) return biz
  if (isReasonablePstnDialString(from)) return from
  if (isReasonablePstnDialString(biz)) return biz
  return ""
}

/** Best-effort external caller E.164 for chaining on Dial `action` URLs (`origFrom` query). */
export function resolveExternalCallerE164ForDialChain(opts: {
  origFromParam: string
  formFromDial: string
}): string {
  if (opts.origFromParam.trim()) {
    const n = normalizePhoneNumberE164(opts.origFromParam.trim())
    if (isReasonablePstnDialString(n)) return n
  }
  const fd = opts.formFromDial.trim()
  if (!fd || fd.toLowerCase() === "unknown") return ""
  const n2 = normalizePhoneNumberE164(fd)
  return isReasonablePstnDialString(n2) ? n2 : ""
}

/** `&origFrom=…` fragment when we have a plausible external caller (empty string if none). */
export function origFromQuerySuffix(url: URL, formData: FormData, fromDial: string): string {
  const p = (url.searchParams.get("origFrom") || String(formData.get("origFrom") || "")).trim()
  const e164 = resolveExternalCallerE164ForDialChain({ origFromParam: p, formFromDial: fromDial })
  return e164 ? `&origFrom=${encodeURIComponent(e164)}` : ""
}

/** Same as `origFromQuerySuffix` when only the raw inbound `From` is known (first `/incoming` hop). */
export function origFromQuerySuffixFromRaw(inboundFromRaw: string): string {
  const e164 = resolveExternalCallerE164ForDialChain({ origFromParam: "", formFromDial: inboundFromRaw })
  return e164 ? `&origFrom=${encodeURIComponent(e164)}` : ""
}

/**
 * Twilio/Telnyx `<Dial answerOnBridge>`.
 * **Default `false`:** answer inbound immediately and start the PSTN B-leg — avoids US ringback
 * playing to the caller before the receptionist phone actually rings.
 * Set `ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE=1` for classic ringback-until-answer.
 */
export function readTelnyxDialAnswerOnBridge(): boolean {
  const raw = (process.env.ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE || "").trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  return false
}
