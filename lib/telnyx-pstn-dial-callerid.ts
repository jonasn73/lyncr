import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"

export type InboundOutboundCallerIdRouting = {
  primary_phone_number?: string | null
  active_phone_count?: number
}

/**
 * Telnyx-owned E.164 for outbound PSTN legs (`from` / `<Dial callerId>`).
 * Multi-DID accounts may use the primary line when the dialed DID is not yet outbound-capable.
 */
export function resolveInboundOutboundCallerId(
  routing: InboundOutboundCallerIdRouting,
  businessLineE164: string
): string {
  const preferPrimaryCallerId = ["1", "true", "yes", "on"].includes(
    (process.env.ZING_INBOUND_PSTN_CALLER_ID_PRIMARY || "").trim().toLowerCase()
  )
  const primaryE164 = routing.primary_phone_number?.trim()
    ? normalizePhoneNumberE164(routing.primary_phone_number)
    : ""
  const multiLine = Number(routing.active_phone_count ?? 1) >= 2
  let outboundCallerId = businessLineE164
  if (preferPrimaryCallerId) {
    if (primaryE164 && isReasonablePstnDialString(primaryE164)) outboundCallerId = primaryE164
  } else if (
    multiLine &&
    primaryE164 &&
    isReasonablePstnDialString(primaryE164) &&
    isReasonablePstnDialString(businessLineE164)
  ) {
    const dialed10 = businessLineE164.replace(/\D/g, "").slice(-10)
    const primary10 = primaryE164.replace(/\D/g, "").slice(-10)
    if (dialed10.length >= 10 && primary10.length >= 10 && dialed10 !== primary10) {
      outboundCallerId = primaryE164
    }
  }
  if (!isReasonablePstnDialString(outboundCallerId) && primaryE164 && isReasonablePstnDialString(primaryE164)) {
    outboundCallerId = primaryE164
  }
  return outboundCallerId
}

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
 * **Default `true`:** US `ringTone` stays in sync with the receptionist PSTN ring (consistent caller audio).
 * Set `ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE=0` to answer inbound immediately (can sound like a tone change when B-leg starts).
 */
export function readTelnyxDialAnswerOnBridge(): boolean {
  const raw = (process.env.ZING_INBOUND_DIAL_ANSWER_ON_BRIDGE || "").trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  return true
}
