// POST /api/telnyx-capture — presence / calendar / day capture callbacks.
// Busy paths: SMS booking link immediately + say + hangup.
// Day Dial BUSY/CONGESTION: live call-waiting deflection.
// Day unanswered: Gather (1 = SMS, 2 = hold queue with calendar ETA).

import { NextRequest, NextResponse } from "next/server"
import { normalizePhoneNumberE164, updateCallLog } from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getAppUrl } from "@/lib/telnyx"
import { toE164 } from "@/lib/phone-e164"
import { getIvrMenuSettingsByInboundDid } from "@/lib/ivr-menu-db"
import { markIvrActionCompleted } from "@/lib/missed-call-rescue"
import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import { buildTelnyxMenuBookingSms } from "@/lib/telnyx-menu"
import {
  localDateTimePartsInZone,
  remainingMinutesInActiveBlockout,
} from "@/lib/schedule-blockouts"
import { listScheduleBlockoutsForDate } from "@/lib/schedule-blockouts-db"
import type { CallType } from "@/lib/types"
import {
  CAPTURE_DEFAULT_RING_E164,
  CAPTURE_STATUS_BUSY_LINK,
  CAPTURE_STATUS_CALENDAR_BUSY,
  CAPTURE_STATUS_CALENDAR_OFF,
  CAPTURE_STATUS_CALL_WAITING,
  CAPTURE_STATUS_CLOSED_LINK,
  CAPTURE_STATUS_DAY_BUSY,
  CAPTURE_STATUS_DAY_LINK,
  CAPTURE_STATUS_EMERGENCY_ANSWERED,
  CAPTURE_STATUS_FULL_DAY_LINK,
  CAPTURE_STATUS_HOLD_QUEUE,
  CAPTURE_STATUS_NIGHT_LINK,
  CAPTURE_STATUS_NIGHT_MENU,
  CAPTURE_STATUS_ON_JOB_LINK,
  CAPTURE_STATUS_PRESENCE_CLOSED,
  CAPTURE_STATUS_PRESENCE_ON_JOB,
  CAPTURE_XML_CONTENT_TYPE,
  DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
  INBOUND_CAPTURE_TIMEZONE,
  LIVE_CALL_WAITING_PROMPT,
  TIED_UP_BOOKING_PROMPT,
  buildCaptureHangupXml,
  buildCaptureSayHangupXml,
  buildCaptureSmsAlreadySentHangupXml,
  buildDayBusyFallbackGatherXml,
  buildDayCaptureDialXml,
  buildHoldQueueGatherXml,
  isCaptureDialLineBusy,
  isCaptureDialUnanswered,
  resolveInboundCapturePlan,
} from "@/lib/inbound-time-capture"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": CAPTURE_XML_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  })
}

function pickField(fields: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = fields[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

async function readFields(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => {
    out[k] = v
  })
  if (req.method === "POST") {
    try {
      const ct = (req.headers.get("content-type") || "").toLowerCase()
      if (ct.includes("application/json")) {
        const json = (await req.json()) as Record<string, unknown>
        for (const [k, v] of Object.entries(json)) {
          if (v != null && !(k in out)) out[k] = String(v)
        }
      } else {
        const form = await req.formData()
        form.forEach((v, k) => {
          if (!(k in out)) out[k] = String(v)
        })
      }
    } catch {
      /* empty */
    }
  }
  return out
}

function captureUrl(qs: Record<string, string>): string {
  const base = `${getAppUrl().replace(/\/+$/, "")}/api/telnyx-capture`
  const params = new URLSearchParams(qs)
  return `${base}?${params.toString()}`
}

async function resolveRingE164(ownerUserId: string | null): Promise<string> {
  if (ownerUserId) {
    try {
      const { findActiveOperatorForAccount } = await import("@/lib/active-operator")
      const active = await findActiveOperatorForAccount(ownerUserId)
      if (active?.phoneE164) return active.phoneE164
    } catch (e) {
      console.warn("[telnyx-capture] active operator lookup failed:", e)
    }
  }
  return CAPTURE_DEFAULT_RING_E164
}

async function resolveSecureBookUrl(opts: {
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

async function fireBookingSms(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  source: string
}): Promise<void> {
  if (!opts.fromE164) return
  const bookUrl = await resolveSecureBookUrl({
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
    if (!sent.ok) console.warn("[telnyx-capture] SMS failed:", sent.error)
  } catch (e) {
    console.warn("[telnyx-capture] SMS threw:", e)
  }
}

async function sendBookingSmsAndHangup(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  callSid: string
  routedToName:
    | typeof CAPTURE_STATUS_NIGHT_LINK
    | typeof CAPTURE_STATUS_DAY_LINK
    | typeof CAPTURE_STATUS_FULL_DAY_LINK
    | typeof CAPTURE_STATUS_BUSY_LINK
    | typeof CAPTURE_STATUS_CLOSED_LINK
    | typeof CAPTURE_STATUS_ON_JOB_LINK
    | typeof CAPTURE_STATUS_CALL_WAITING
  source: string
  /** When set, play this instead of the generic "we just texted" goodbye. */
  sayPrompt?: string
}): Promise<string> {
  await fireBookingSms({
    fromE164: opts.fromE164,
    ownerUserId: opts.ownerUserId,
    businessLineE164: opts.businessLineE164,
    source: opts.source,
  })

  if (opts.callSid) {
    void updateCallLog(opts.callSid, {
      routed_to_name: opts.routedToName,
      call_type: "missed",
      status: "completed",
    }).catch((e) => console.warn("[telnyx-capture] status tag failed:", e))
    void markIvrActionCompleted(opts.callSid)
  }

  if (opts.sayPrompt) {
    return buildCaptureSmsAlreadySentHangupXml(opts.sayPrompt)
  }
  return buildCaptureSayHangupXml(
    "Perfect, we just texted that booking link to your phone. Goodbye!"
  )
}

async function tagCall(
  callSid: string,
  patch: { routed_to_name: string; call_type?: CallType; status?: string }
): Promise<void> {
  if (!callSid) return
  try {
    await updateCallLog(callSid, {
      routed_to_name: patch.routed_to_name,
      ...(patch.call_type ? { call_type: patch.call_type } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    })
  } catch (e) {
    console.warn("[telnyx-capture] tag failed:", e)
  }
}

async function resolveHoldEtaMinutes(ownerUserId: string | null): Promise<number> {
  if (!ownerUserId) return 20
  try {
    const now = new Date()
    const { dateKey } = localDateTimePartsInZone(now, INBOUND_CAPTURE_TIMEZONE)
    const blockouts = await listScheduleBlockoutsForDate({
      ownerUserId,
      dateKey,
    })
    const left = remainingMinutesInActiveBlockout(
      blockouts,
      now,
      INBOUND_CAPTURE_TIMEZONE
    )
    if (left != null && left > 0) return left
  } catch (e) {
    console.warn("[telnyx-capture] hold ETA lookup failed:", e)
  }
  return 20
}

/** Entry: presence / calendar SMS hangup or day Dial TeXML. */
export async function GET(req: NextRequest) {
  const fields: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => {
    fields[k] = v
  })
  return handleEntry(fields)
}

export async function POST(req: NextRequest) {
  const fields = await readFields(req)
  const step = pickField(fields, ["step", "mode"])
  const digits = pickField(fields, ["Digits", "digits", "Digit", "dtmf"])
  const fromRaw = pickField(fields, ["From", "from", "Caller", "caller"])
  const toRaw = pickField(fields, ["To", "to", "Called", "called"])
  const fromE164 = fromRaw ? normalizePhoneNumberE164(fromRaw) || toE164(fromRaw) : ""
  const businessLineE164 = toRaw ? normalizePhoneNumberE164(toRaw) || toE164(toRaw) : ""
  const callSid = pickField(fields, ["CallSid", "CallControlId", "call_control_id"])
  const dialStatus = pickField(fields, [
    "DialCallStatus",
    "DialStatus",
    "DialCallLegStatus",
    "DialCallLegState",
  ])

  let ownerUserId: string | null = null
  if (toRaw) {
    try {
      const ctx = await getIvrMenuSettingsByInboundDid(toRaw)
      ownerUserId = ctx.ownerUserId
    } catch {
      ownerUserId = null
    }
  }
  const ringE164 = await resolveRingE164(ownerUserId)

  if (step === "vm-done") {
    return xmlResponse(buildCaptureSayHangupXml("Thank you. Goodbye."))
  }

  // Legacy Gather action URLs for calendar / presence — SMS + hangup.
  if (
    step === "calendar-off" ||
    step === "calendar-busy" ||
    step === "presence-closed" ||
    step === "presence-on-job"
  ) {
    const routedToName =
      step === "calendar-off"
        ? CAPTURE_STATUS_FULL_DAY_LINK
        : step === "calendar-busy"
          ? CAPTURE_STATUS_BUSY_LINK
          : step === "presence-closed"
            ? CAPTURE_STATUS_CLOSED_LINK
            : CAPTURE_STATUS_ON_JOB_LINK
    return xmlResponse(
      await sendBookingSmsAndHangup({
        fromE164,
        ownerUserId,
        businessLineE164,
        callSid,
        routedToName,
        source: `capture_${step.replace(/-/g, "_")}`,
        sayPrompt: TIED_UP_BOOKING_PROMPT,
      })
    )
  }

  // Night Gather result (Press 1 / timeout → SMS, Press 2 → emergency Dial).
  if (step === "night") {
    void tagCall(callSid, {
      routed_to_name: CAPTURE_STATUS_NIGHT_MENU,
      call_type: "missed",
    })

    if (digits === "2") {
      void tagCall(callSid, {
        routed_to_name: CAPTURE_STATUS_EMERGENCY_ANSWERED,
        call_type: "incoming",
        status: "ringing",
      })
      return xmlResponse(
        buildDayCaptureDialXml({
          ringE164,
          actionUrl: captureUrl({ step: "emergency-dial" }),
          callerId: businessLineE164 || null,
          timeoutSeconds: 30,
        })
      )
    }

    return xmlResponse(
      await sendBookingSmsAndHangup({
        fromE164,
        ownerUserId,
        businessLineE164,
        callSid,
        routedToName: CAPTURE_STATUS_NIGHT_LINK,
        source: "capture_night",
      })
    )
  }

  // Emergency Dial ended — if unanswered, offer night SMS as safety net.
  if (step === "emergency-dial") {
    if (!isCaptureDialUnanswered(dialStatus)) {
      void tagCall(callSid, {
        routed_to_name: CAPTURE_STATUS_EMERGENCY_ANSWERED,
        call_type: "incoming",
        status: "completed",
      })
      return xmlResponse(buildCaptureHangupXml())
    }
    return xmlResponse(
      await sendBookingSmsAndHangup({
        fromE164,
        ownerUserId,
        businessLineE164,
        callSid,
        routedToName: CAPTURE_STATUS_NIGHT_LINK,
        source: "capture_emergency_miss",
      })
    )
  }

  // Day Dial action — answered → hangup; BUSY/CONGESTION → call-waiting SMS; else busy Gather.
  if (step === "day-fallback") {
    if (dialStatus && !isCaptureDialUnanswered(dialStatus)) {
      return xmlResponse(buildCaptureHangupXml())
    }

    // Live call waiting — your cell is already on another call.
    if (isCaptureDialLineBusy(dialStatus)) {
      return xmlResponse(
        await sendBookingSmsAndHangup({
          fromE164,
          ownerUserId,
          businessLineE164,
          callSid,
          routedToName: CAPTURE_STATUS_CALL_WAITING,
          source: "capture_call_waiting",
          sayPrompt: LIVE_CALL_WAITING_PROMPT,
        })
      )
    }

    void tagCall(callSid, {
      routed_to_name: CAPTURE_STATUS_DAY_BUSY,
      call_type: "missed",
    })
    return xmlResponse(buildDayBusyFallbackGatherXml(captureUrl({ step: "day-busy" })))
  }

  // Day busy Gather — 1 / timeout → SMS; 2 → hold queue with calendar ETA.
  if (step === "day-busy") {
    if (digits === "2") {
      void tagCall(callSid, {
        routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
        call_type: "missed",
      })
      const eta = await resolveHoldEtaMinutes(ownerUserId)
      return xmlResponse(buildHoldQueueGatherXml(captureUrl({ step: "hold-queue" }), eta))
    }
    return xmlResponse(
      await sendBookingSmsAndHangup({
        fromE164,
        ownerUserId,
        businessLineE164,
        callSid,
        routedToName: CAPTURE_STATUS_DAY_LINK,
        source: "capture_day",
      })
    )
  }

  // Hold queue — Press 1 / timeout → priority booking SMS; stay loops with refreshed ETA.
  if (step === "hold-queue") {
    if (digits === "1" || !digits) {
      return xmlResponse(
        await sendBookingSmsAndHangup({
          fromE164,
          ownerUserId,
          businessLineE164,
          callSid,
          routedToName: CAPTURE_STATUS_DAY_LINK,
          source: "capture_hold_priority",
        })
      )
    }
    // Any other digit — re-announce ETA and keep holding.
    void tagCall(callSid, {
      routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
      call_type: "missed",
    })
    const eta = await resolveHoldEtaMinutes(ownerUserId)
    return xmlResponse(buildHoldQueueGatherXml(captureUrl({ step: "hold-queue" }), eta))
  }

  // No step → entry (presence / calendar SMS or day Dial).
  return handleEntry(fields, ownerUserId, ringE164, businessLineE164, callSid)
}

async function handleEntry(
  fields: Record<string, string>,
  ownerUserId?: string | null,
  ringE164?: string,
  businessLineE164?: string,
  callSid?: string
): Promise<NextResponse> {
  const toRaw = pickField(fields, ["To", "to", "Called", "called"])
  const fromRaw = pickField(fields, ["From", "from", "Caller", "caller"])
  const sid =
    callSid ||
    pickField(fields, ["CallSid", "CallControlId", "call_control_id"])
  const line =
    businessLineE164 ||
    (toRaw ? normalizePhoneNumberE164(toRaw) || toE164(toRaw) : "")
  const fromE164 = fromRaw ? normalizePhoneNumberE164(fromRaw) || toE164(fromRaw) : ""

  let owner = ownerUserId ?? null
  if (owner === undefined || owner === null) {
    if (toRaw) {
      try {
        owner = (await getIvrMenuSettingsByInboundDid(toRaw)).ownerUserId
      } catch {
        owner = null
      }
    }
  }
  const ring = ringE164 || (await resolveRingE164(owner))
  const plan = await resolveInboundCapturePlan({ ownerUserId: owner })

  // CLOSED / ON_JOB / calendar → skip cell, SMS booking link, play tied-up prompt, hangup.
  if (
    plan.kind === "presence_closed" ||
    plan.kind === "presence_on_job" ||
    plan.kind === "calendar_full_day" ||
    plan.kind === "calendar_partial"
  ) {
    const routedToName =
      plan.kind === "presence_closed"
        ? CAPTURE_STATUS_CLOSED_LINK
        : plan.kind === "presence_on_job"
          ? CAPTURE_STATUS_ON_JOB_LINK
          : plan.kind === "calendar_full_day"
            ? CAPTURE_STATUS_FULL_DAY_LINK
            : CAPTURE_STATUS_BUSY_LINK
    const menuTag =
      plan.kind === "presence_closed"
        ? CAPTURE_STATUS_PRESENCE_CLOSED
        : plan.kind === "presence_on_job"
          ? CAPTURE_STATUS_PRESENCE_ON_JOB
          : plan.kind === "calendar_full_day"
            ? CAPTURE_STATUS_CALENDAR_OFF
            : CAPTURE_STATUS_CALENDAR_BUSY
    if (sid) {
      void tagCall(sid, {
        routed_to_name: menuTag,
        call_type: "missed",
        status: "ringing",
      })
    }
    return xmlResponse(
      await sendBookingSmsAndHangup({
        fromE164,
        ownerUserId: owner,
        businessLineE164: line,
        callSid: sid,
        routedToName,
        source: `capture_${plan.kind}`,
        sayPrompt: TIED_UP_BOOKING_PROMPT,
      })
    )
  }

  if (sid) {
    void tagCall(sid, {
      routed_to_name: "Owner",
      call_type: "incoming",
      status: "ringing",
    })
  }
  return xmlResponse(
    buildDayCaptureDialXml({
      ringE164: ring,
      actionUrl: captureUrl({ step: "day-fallback" }),
      callerId: line || null,
      timeoutSeconds: DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
    })
  )
}
