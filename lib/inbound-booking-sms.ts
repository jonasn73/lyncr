// Shared booking-link SMS for TeXML capture + Call Control Busy menu (press 1 / timeout).

import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import {
  buildTelnyxMenuBookingSms,
  type BookingLinkSmsTone,
} from "@/lib/telnyx-menu"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { updateCallLog } from "@/lib/db"
import type { CallType } from "@/lib/types"
import {
  claimIvrAction,
  hasOutboundSmsToCustomerRecently,
} from "@/lib/booking-sms-guards"

/** Default auto-SMS cooldown — kill duplicate press-1 / rescue / max-wait blasts. */
const BOOKING_SMS_COOLDOWN_MINUTES = 45

/** Build a secure /book or /b invite URL (falls back to query-string book link). */
async function resolveInboundBookingUrl(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164?: string
  source: string
  /** When false, force a brand-new invite (rare). Default reuses open same-day invite. */
  reuseOpen?: boolean
}): Promise<string> {
  const line = opts.businessLineE164?.trim() || ""
  if (opts.ownerUserId && line) {
    const created = await createBookingInvite({
      ownerUserId: opts.ownerUserId,
      businessLine: line,
      callerPhone: opts.fromE164 || null,
      source: opts.source,
      reuseOpen: opts.reuseOpen,
    })
    if (created?.url) return created.url
  }
  return buildBookQueryUrl({
    callerPhone: opts.fromE164,
    businessLine: line || opts.fromE164,
  })
}

/** Text the booking SMS to the caller (no TeXML / Call Control side effects). */
async function sendInboundBookingSms(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  source: string
  /** Shop name for SMS (“Key Squad — when you need us…”). */
  businessLabel?: string | null
  /** Press-1 vs missed vs hold-timeout copy. */
  tone?: BookingLinkSmsTone
  /**
   * Skip the 45-min cooldown (operator manual send). Auto paths keep dedupe on.
   */
  bypassCooldown?: boolean
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (!opts.fromE164) return { ok: false, error: "missing from" }

  const tone = opts.tone ?? "booking_link"

  // Hard dedupe: any recent outbound to this caller blocks another auto booking link.
  if (!opts.bypassCooldown && opts.ownerUserId) {
    const recently = await hasOutboundSmsToCustomerRecently({
      ownerUserId: opts.ownerUserId,
      customerPhone: opts.fromE164,
      withinHours: BOOKING_SMS_COOLDOWN_MINUTES / 60,
    })
    if (recently) {
      console.log(
        JSON.stringify({
          zing: "inbound-booking-sms-deduped",
          source: opts.source,
          cooldownMinutes: BOOKING_SMS_COOLDOWN_MINUTES,
        })
      )
      return { ok: true, skipped: true }
    }
  }

  const bookUrl = await resolveInboundBookingUrl({
    fromE164: opts.fromE164,
    ownerUserId: opts.ownerUserId,
    businessLineE164: opts.businessLineE164,
    source: opts.source,
  })
  const text = buildTelnyxMenuBookingSms(
    opts.fromE164,
    bookUrl,
    opts.businessLineE164,
    tone,
    opts.businessLabel
  )
  try {
    // Prefer workspace log so Messages inbox + cooldown lookback see press-1 texts.
    if (opts.ownerUserId) {
      const sent = await sendAndLogWorkspaceCustomerSms({
        ownerUserId: opts.ownerUserId,
        toE164: opts.fromE164,
        text,
        fromE164: opts.businessLineE164 || null,
      })
      if (!sent.ok) {
        console.warn("[inbound-booking-sms] SMS failed:", sent.error)
        return { ok: false, error: sent.error }
      }
      return { ok: true }
    }
    const sent = await sendTelnyxSms({
      toE164: opts.fromE164,
      text,
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

/** SMS + tag the call log as a booking-link send (Call Control / capture). */
export async function sendInboundBookingSmsAndTag(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  callSid: string
  routedToName: string
  source: string
  callType?: CallType
  businessLabel?: string | null
  tone?: BookingLinkSmsTone
}): Promise<void> {
  // First hangup wins. Second overlapping event does not send another book link.
  if (opts.callSid) {
    const won = await claimIvrAction(opts.callSid)
    if (!won) return
  }
  await sendInboundBookingSms({
    fromE164: opts.fromE164,
    ownerUserId: opts.ownerUserId,
    businessLineE164: opts.businessLineE164,
    source: opts.source,
    businessLabel: opts.businessLabel,
    tone: opts.tone,
  })
  if (opts.callSid) {
    void updateCallLog(opts.callSid, {
      routed_to_name: opts.routedToName,
      call_type: opts.callType ?? "missed",
      status: "completed",
    }).catch((e) => console.warn("[inbound-booking-sms] status tag failed:", e))
  }
}
