// Shared booking-link SMS for TeXML capture + Call Control Busy menu (press 1 / timeout).

import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import { buildTelnyxMenuBookingSms } from "@/lib/telnyx-menu"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { updateCallLog } from "@/lib/db"
import type { CallType } from "@/lib/types"
import { markIvrActionCompleted } from "@/lib/missed-call-rescue"

/** Build a secure /book invite URL (falls back to query-string book link). */
export async function resolveInboundBookingUrl(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164?: string
  source: string
}): Promise<string> {
  const line = opts.businessLineE164?.trim() || ""
  if (opts.ownerUserId && line) {
    const created = await createBookingInvite({
      ownerUserId: opts.ownerUserId,
      businessLine: line,
      callerPhone: opts.fromE164 || null,
      source: opts.source,
    })
    if (created?.url) return created.url
  }
  return buildBookQueryUrl({
    callerPhone: opts.fromE164,
    businessLine: line || opts.fromE164,
  })
}

/** Text the booking SMS to the caller (no TeXML / Call Control side effects). */
export async function sendInboundBookingSms(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  source: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!opts.fromE164) return { ok: false, error: "missing from" }
  const bookUrl = await resolveInboundBookingUrl({
    fromE164: opts.fromE164,
    ownerUserId: opts.ownerUserId,
    businessLineE164: opts.businessLineE164,
    source: opts.source,
  })
  const text = buildTelnyxMenuBookingSms(opts.fromE164, bookUrl, opts.businessLineE164)
  try {
    const sent = await sendTelnyxSms({
      toE164: opts.fromE164,
      text,
      userId: opts.ownerUserId || undefined,
    })
    if (!sent.ok) {
      console.warn("[inbound-booking-sms] SMS failed:", sent.error)
      return { ok: false, error: sent.error }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[inbound-booking-sms] SMS threw:", e)
    return { ok: false, error: msg }
  }
}

/** SMS + tag the call log as a missed booking-link send (Call Control / capture). */
export async function sendInboundBookingSmsAndTag(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  callSid: string
  routedToName: string
  source: string
  callType?: CallType
}): Promise<void> {
  await sendInboundBookingSms({
    fromE164: opts.fromE164,
    ownerUserId: opts.ownerUserId,
    businessLineE164: opts.businessLineE164,
    source: opts.source,
  })
  if (opts.callSid) {
    void updateCallLog(opts.callSid, {
      routed_to_name: opts.routedToName,
      call_type: opts.callType ?? "missed",
      status: "completed",
    }).catch((e) => console.warn("[inbound-booking-sms] status tag failed:", e))
    void markIvrActionCompleted(opts.callSid)
  }
}
