// Shared booking-link SMS for TeXML capture + Call Control Busy menu (press 1 / timeout).

import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import {
  buildTelnyxMenuBookingSms,
  type BookingLinkSmsTone,
} from "@/lib/telnyx-menu"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getActivePhoneNumberByE164, updateCallLog } from "@/lib/db"
import { callerGreetingPrefix } from "@/lib/hold-queue"
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
      // The called DID already identifies the shop — resolve it explicitly so multi-shop
      // owners don't hit resolveWorkspaceSmsSender's "more than one shop" guard and fail
      // every press-1 send (that guard only accepts an org it wasn't told to look up).
      const line = opts.businessLineE164
        ? await getActivePhoneNumberByE164(opts.businessLineE164)
        : null
      const organizationId =
        line?.organization_id && !line.organization_id.startsWith("legacy-")
          ? line.organization_id
          : null
      const sent = await sendAndLogWorkspaceCustomerSms({
        ownerUserId: opts.ownerUserId,
        toE164: opts.fromE164,
        text,
        fromE164: opts.businessLineE164 || null,
        organizationId,
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

export type InboundBookingSmsOutcome = "sent" | "skipped" | "failed" | "not_attempted"

/**
 * What to tell the caller on the confirmation Speak — never claims a text went out
 * unless it actually did. "press1" = explicit press-1 confirm; "max_wait" = hold
 * timed out / capacity-reached soft-busy prompt (same shape, different framing).
 * Reuses the same known-name / repeat-caller signal as the initial Busy greeting
 * (carried in call-control state, not re-queried here).
 */
export function bookingSmsConfirmSpeech(
  outcome: InboundBookingSmsOutcome,
  variant: "press1" | "max_wait",
  opts?: { callerDisplayName?: string | null; isRepeatCaller?: boolean }
): string {
  const prefix = callerGreetingPrefix({
    callerDisplayName: opts?.callerDisplayName,
    isRepeatCaller: opts?.isRepeatCaller,
  })
  const body = bookingSmsConfirmBody(outcome, variant)
  return prefix ? `${prefix}${body}` : body
}

function bookingSmsConfirmBody(
  outcome: InboundBookingSmsOutcome,
  variant: "press1" | "max_wait"
): string {
  if (variant === "max_wait") {
    if (outcome === "sent") {
      return "We are still tied up. We just texted you a booking link so you can tell us when you need us. Goodbye."
    }
    if (outcome === "skipped") {
      return "We are still tied up. You should already have a text from us with a booking link. Goodbye."
    }
    return "We are still tied up — thanks for your patience, we'll follow up with you shortly. Goodbye."
  }
  if (outcome === "sent") {
    return "We just texted you a booking link. You can hang up whenever you're ready."
  }
  if (outcome === "skipped") {
    return "You should already have a text from us with a booking link. You can hang up whenever you're ready."
  }
  return "Thanks for calling — we'll follow up with you shortly. You can hang up whenever you're ready."
}

/**
 * SMS + tag the call log as a booking-link send (Call Control / capture).
 * The tagged routed_to_name reflects the REAL outcome — a failed or cooldown-skipped
 * send is never tagged as if the text went out. Callers can react to the returned
 * outcome (e.g. choose what to tell the caller on the confirmation Speak).
 */
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
}): Promise<{ outcome: InboundBookingSmsOutcome; error?: string }> {
  // First hangup wins. Second overlapping event does not send another book link.
  if (opts.callSid) {
    const won = await claimIvrAction(opts.callSid)
    if (!won) return { outcome: "not_attempted" }
  }
  const result = await sendInboundBookingSms({
    fromE164: opts.fromE164,
    ownerUserId: opts.ownerUserId,
    businessLineE164: opts.businessLineE164,
    source: opts.source,
    businessLabel: opts.businessLabel,
    tone: opts.tone,
  })
  const outcome: InboundBookingSmsOutcome = !result.ok
    ? "failed"
    : result.skipped
      ? "skipped"
      : "sent"
  const routedToName =
    outcome === "failed"
      ? `${opts.routedToName} (text failed)`
      : outcome === "skipped"
        ? `${opts.routedToName} (recent text)`
        : opts.routedToName
  if (opts.callSid) {
    void updateCallLog(opts.callSid, {
      routed_to_name: routedToName,
      call_type: opts.callType ?? "missed",
      status: "completed",
    }).catch((e) => console.warn("[inbound-booking-sms] status tag failed:", e))
  }
  return { outcome, error: result.error }
}
