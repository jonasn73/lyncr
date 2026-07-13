// POST /api/telnyx-capture — night / day time-based inbound capture callbacks.
// Night: Gather → SMS (1 / timeout) or emergency Dial (2).
// Day: Dial action → busy Gather → SMS (1 / timeout) or voicemail hold (2).

import { NextRequest, NextResponse } from "next/server"
import { normalizePhoneNumberE164, updateCallLog } from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { getAppUrl } from "@/lib/telnyx"
import { toE164 } from "@/lib/phone-e164"
import { getIvrMenuSettingsByInboundDid } from "@/lib/ivr-menu-db"
import { markIvrActionCompleted } from "@/lib/missed-call-rescue"
import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import { buildTelnyxMenuBookingSms } from "@/lib/telnyx-menu"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  CAPTURE_DEFAULT_RING_E164,
  CAPTURE_STATUS_DAY_BUSY,
  CAPTURE_STATUS_DAY_LINK,
  CAPTURE_STATUS_EMERGENCY_ANSWERED,
  CAPTURE_STATUS_NIGHT_LINK,
  CAPTURE_STATUS_NIGHT_MENU,
  CAPTURE_XML_CONTENT_TYPE,
  DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
  buildCaptureHangupXml,
  buildCaptureSayHangupXml,
  buildDayBusyFallbackGatherXml,
  buildDayCaptureDialXml,
  buildDayHoldVoicemailXml,
  buildNightCaptureGatherXml,
  isCaptureDialUnanswered,
  isNightMode,
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
      const sql = neon(resolveNeonDatabaseUrl())
      const rows = await sql`
        SELECT
          NULLIF(trim(u.phone), '') AS owner_phone,
          NULLIF(trim(rc.custom_routing_phone), '') AS custom_phone
        FROM users u
        LEFT JOIN routing_config rc
          ON rc.user_id = u.id AND rc.business_number IS NULL
        WHERE u.id = ${ownerUserId}
        LIMIT 1
      `
      const row = rows[0] as { owner_phone?: string | null; custom_phone?: string | null } | undefined
      const custom = row?.custom_phone
        ? normalizePhoneNumberE164(row.custom_phone) || toE164(row.custom_phone)
        : ""
      const owner = row?.owner_phone
        ? normalizePhoneNumberE164(row.owner_phone) || toE164(row.owner_phone)
        : ""
      if (custom) return custom
      if (owner) return owner
    } catch (e) {
      console.warn("[telnyx-capture] ring lookup failed:", e)
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

async function sendBookingSmsAndHangup(opts: {
  fromE164: string
  ownerUserId: string | null
  businessLineE164: string
  callSid: string
  /** Night vs day status label for Activities / Missed Call Rescue. */
  routedToName: typeof CAPTURE_STATUS_NIGHT_LINK | typeof CAPTURE_STATUS_DAY_LINK
  source: string
}): Promise<string> {
  if (opts.fromE164) {
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

  if (opts.callSid) {
    void updateCallLog(opts.callSid, {
      routed_to_name: opts.routedToName,
      call_type: "missed",
      status: "completed",
    }).catch((e) => console.warn("[telnyx-capture] status tag failed:", e))
    void markIvrActionCompleted(opts.callSid)
  }

  return buildCaptureSayHangupXml(
    "Perfect, we just texted that booking link to your phone. Goodbye!"
  )
}

async function tagCall(
  callSid: string,
  patch: { routed_to_name: string; call_type?: string; status?: string }
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

/** Entry: night Gather or day Dial TeXML (also used by incoming redirect). */
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

  // Night Gather result (Press 1 / timeout → SMS, Press 2 → emergency Dial).
  if (step === "night") {
    void tagCall(callSid, {
      routed_to_name: CAPTURE_STATUS_NIGHT_MENU,
      call_type: "missed",
    })

    if (digits === "2") {
      // Emergency — ring on-call line; action tags Emergency Answered / fallthrough.
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

    // Press 1, stay on line, or timeout → SMS night link.
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

  // Day Dial action — unanswered → busy Gather; answered → hangup.
  if (step === "day-fallback") {
    if (dialStatus && !isCaptureDialUnanswered(dialStatus)) {
      return xmlResponse(buildCaptureHangupXml())
    }
    void tagCall(callSid, {
      routed_to_name: CAPTURE_STATUS_DAY_BUSY,
      call_type: "missed",
    })
    return xmlResponse(buildDayBusyFallbackGatherXml(captureUrl({ step: "day-busy" })))
  }

  // Day busy Gather — 1 / timeout → SMS; 2 → voicemail hold.
  if (step === "day-busy") {
    if (digits === "2") {
      void tagCall(callSid, {
        routed_to_name: "Voicemail",
        call_type: "voicemail",
      })
      return xmlResponse(buildDayHoldVoicemailXml(captureUrl({ step: "vm-done" })))
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

  // No step → entry (night Gather or day Dial).
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

  if (isNightMode()) {
    if (sid) {
      void tagCall(sid, {
        routed_to_name: CAPTURE_STATUS_NIGHT_MENU,
        call_type: "missed",
        status: "ringing",
      })
    }
    return xmlResponse(buildNightCaptureGatherXml(captureUrl({ step: "night" })))
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
