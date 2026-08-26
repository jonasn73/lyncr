// ============================================
// GET/POST /api/voice/telnyx/receptionist-answer
// ============================================
// Telnyx fetches this `<Number url="…" method="POST">` document the instant the callee leg
// answers (before bridging to the caller).
//
// Your Phone / owner cell: bridge immediately (no DTMF). Stamp answered_at + CRM notify.
// Receptionist legs (`r=`): optional Press-1 anti-voicemail screen (unless env-disabled).

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { getAppUrl } from "@/lib/telnyx"
import { sanitizeWhisperPhrase } from "@/lib/inbound-line-whisper"
import { texmlSayWhisperPlain } from "@/lib/texml-say-voice"
import {
  buildReceptionistPress1AcceptedTexml,
  buildReceptionistPress1RejectedTexml,
  buildReceptionistPress1ScreenTexml,
} from "@/lib/receptionist-screen-texml"
import { handleCallConnected } from "@/app/actions/call-events"
import { notifyOwnerInboundCallAnswered } from "@/lib/inbound-call-answered-broadcast"
import type { ReceptionistBusinessType } from "@/lib/business-type"
import { VoiceResponse } from "@/lib/telnyx"
import { updateCallLog } from "@/lib/db"
import { OWNER_PHONE_ROUTED_TO_NAME } from "@/lib/missed-call-telemetry"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

// Press-1 screening is OFF unless explicitly asked for.
//
// It was added as an anti-voicemail gate: without it an unanswered cell can bridge
// the caller into the receptionist's personal voicemail greeting. But it also meant
// a receptionist who picked up and simply talked was never recorded as having
// answered — no bridge, no answered_at, no intake, and no pay for the call. A gate
// that silently drops real answered calls costs more than the voicemail it prevents.
//
// Owner legs already skipped it (31ce84e4); receptionist legs now match.
const PRESS1_SCREEN_ENABLED = ["1", "true", "yes"].includes(
  (process.env.ZING_RECEPTIONIST_PRESS1_SCREEN || "").trim().toLowerCase()
)

function param(req: NextRequest, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = req.nextUrl.searchParams.get(k)
    if (v != null && v.trim() !== "") return v.trim()
  }
  return null
}

function whisperPhrase(req: NextRequest): string | null {
  const raw = param(req, "p", "phrase")
  if (!raw) return null
  try {
    const cleaned = sanitizeWhisperPhrase(decodeURIComponent(raw))
    return cleaned.length > 0 ? cleaned : null
  } catch {
    return null
  }
}

function normalizeBusinessType(raw: string | null): ReceptionistBusinessType {
  if (raw === "locksmith" || raw === "detailing" || raw === "auto_repair" || raw === "generic") return raw
  return "generic"
}

function xmlResponseBody(body: string): NextResponse {
  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  })
}

function gateActionUrl(req: NextRequest): string {
  const qs = new URLSearchParams(req.nextUrl.searchParams)
  qs.set("g", "1")
  return `${getAppUrl().replace(/\/+$/, "")}/api/voice/telnyx/receptionist-answer?${qs.toString()}`
}

async function readPressedDigit(req: NextRequest): Promise<string> {
  const fromQuery = param(req, "Digits", "digits")
  if (fromQuery) return fromQuery.trim()
  if (req.method === "POST") {
    try {
      const form = await req.formData()
      const d = form.get("Digits") ?? form.get("digits")
      if (typeof d === "string") return d.trim()
    } catch {
      /* no form body */
    }
  }
  return ""
}

function resolveProviderCallSid(req: NextRequest): string {
  return param(req, "cl", "callSid", "callLogId") ?? ""
}

/**
 * Confirmed live answer (owner immediate bridge, or receptionist press-1 / screen-off).
 * Sets answered_at so Activities / Missed Call Rescue treat the leg as live.
 */
async function notifyOwnerCrmAnswered(req: NextRequest): Promise<void> {
  const callSid = resolveProviderCallSid(req)
  if (!callSid) return
  const ownerUserId = param(req, "u", "ownerUserId")
  const callLogId = param(req, "lid", "callLogId")
  const fromNumber = param(req, "from", "caller")
  const toNumber = param(req, "to")
  const receptionistId = param(req, "r", "receptionistId")

  // AWAITED, not fire-and-forget. This is the only writer of answered_at on the TeXML
  // path — the status webhook passes skipAnsweredAt precisely because it defers to
  // here — and an un-awaited promise in a serverless function can be frozen with the
  // instance before it settles. That is why answered_at landed on some calls and not
  // others: every unstamped call is invisible to intake, to Activities, and to pay,
  // because pay requires a real pickup.
  try {
    await updateCallLog(callSid, {
      call_type: "incoming",
      status: "in-progress",
      answered_at: new Date().toISOString(),
      ...(receptionistId?.trim() ? {} : { routed_to_name: OWNER_PHONE_ROUTED_TO_NAME }),
    })
  } catch (e) {
    // Never fail the bridge over the bookkeeping — the caller is waiting on this
    // document. A missed stamp is recoverable; a dropped call is not.
    console.warn("[receptionist-answer] call-log answer tag failed:", e)
  }

  await notifyOwnerInboundCallAnswered({
    providerCallSid: callSid,
    ownerUserId,
    callLogId,
    fromNumber,
    toNumber,
    callerName: param(req, "cn", "callerName"),
  }).catch((e) => {
    console.error("[receptionist-answer] owner call-answered broadcast failed:", e)
  })
}

/** Receptionist HUD — on immediate bridge, or after a press-1 accept when screening is on. */
function scheduleReceptionistHudConnected(req: NextRequest, receptionistId: string): void {
  const callSid = resolveProviderCallSid(req)
  if (!callSid) return
  // `after` throws when there is no request scope. This runs on the path that returns
  // the bridge TeXML, so letting that escape would fail the whole document and drop a
  // live call for the sake of a HUD notification. The portal polls regardless.
  try {
    scheduleHudBroadcast(req, receptionistId, callSid)
  } catch (e) {
    console.error("[receptionist-answer] could not schedule HUD broadcast:", e)
  }
}

function scheduleHudBroadcast(req: NextRequest, receptionistId: string, callSid: string): void {
  after(async () => {
    try {
      await handleCallConnected({
        receptionistId: receptionistId.trim(),
        callLogId: callSid,
        businessType: normalizeBusinessType(param(req, "bt", "businessType")),
        callerNumber: param(req, "from", "caller"),
        callerName: param(req, "cn", "callerName"),
        businessName: param(req, "bn", "businessName"),
      })
    } catch (e) {
      console.error("[receptionist-answer] receptionist HUD broadcast failed:", e)
    }
  })
}

/** Empty (or whisper-only) TeXML — completes `<Number url>` and bridges the caller now. */
function immediateBridgeXml(phrase: string | null): string {
  const texml = new VoiceResponse()
  if (phrase) texmlSayWhisperPlain(texml, phrase)
  return texml.toString()
}

async function respond(req: NextRequest): Promise<NextResponse> {
  const isGate = param(req, "g") === "1"
  const businessName = param(req, "bn", "businessName") || "your business"
  const receptionistId = param(req, "r", "receptionistId")
  const phrase = whisperPhrase(req)
  const isOwnerLeg = !receptionistId?.trim()

  // Gate callback (receptionist Press-1 Gather action) — digit 1 accepts, anything else rejects.
  if (isGate) {
    const digit = await readPressedDigit(req)
    if (digit === "1") {
      await notifyOwnerCrmAnswered(req)
      if (receptionistId?.trim()) scheduleReceptionistHudConnected(req, receptionistId)
      return xmlResponseBody(buildReceptionistPress1AcceptedTexml())
    }
    return xmlResponseBody(buildReceptionistPress1RejectedTexml())
  }

  // Your Phone / owner cell: no Press-1 — stamp answered + bridge the caller immediately.
  if (isOwnerLeg) {
    await notifyOwnerCrmAnswered(req)
    return xmlResponseBody(immediateBridgeXml(phrase))
  }

  // Receptionist cell: bridge on pickup, same as the owner leg. Stamp answered_at and
  // open the HUD so the call is recorded, payable, and has an intake form.
  if (!PRESS1_SCREEN_ENABLED) {
    await notifyOwnerCrmAnswered(req)
    scheduleReceptionistHudConnected(req, receptionistId!)
    return xmlResponseBody(immediateBridgeXml(phrase))
  }

  // Opt-in only. Press-1 before bridging (anti-voicemail); answered_at is deliberately
  // not stamped until the key arrives, because nobody has accepted the call yet.
  return xmlResponseBody(
    buildReceptionistPress1ScreenTexml(businessName, gateActionUrl(req), {
      whisperPhrase: phrase,
    })
  )
}

export async function GET(req: NextRequest) {
  return respond(req)
}

export async function POST(req: NextRequest) {
  return respond(req)
}
