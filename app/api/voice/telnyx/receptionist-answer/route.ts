// ============================================
// GET/POST /api/voice/telnyx/receptionist-answer
// ============================================
// Telnyx fetches this `<Number url="…">` document the instant the receptionist's cell phone
// answers (before bridging to the caller). It runs ONLY on the receptionist's leg, so we use it to
// screen the call with a private Lyncr whisper + "Press 1 to connect" gate:
//
//   1. On answer we play: "Lyncr Alert. Incoming call for {business}. Press 1 to connect." inside a
//      <Gather> (1 DTMF digit). Nobody-pressed / wrong key → we hang up THIS leg only, so the caller
//      flows down the normal no-answer fallback chain (owner / AI / voicemail) instead of dumping
//      into the agent's personal voicemail.
//   2. When they press 1, the gate returns empty TeXML → the <Number> screen completes → Telnyx
//      bridges the caller, and we broadcast `call-connected` so the agent's HUD pops the intake form.
//
// Screening can be disabled with ZING_RECEPTIONIST_PRESS1_SCREEN=0 (falls back to the old behaviour:
// optional whisper, then immediate bridge).

import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { sanitizeWhisperPhrase } from "@/lib/inbound-line-whisper"
import { texmlSayWhisperPlain, getTexmlSayVoiceAttributes } from "@/lib/texml-say-voice"
import { handleCallConnected } from "@/app/actions/call-events"
import type { ReceptionistBusinessType } from "@/lib/business-type"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

const PRESS1_SCREEN_DISABLED = ["0", "false", "no"].includes(
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

function xmlResponse(texml: InstanceType<typeof VoiceResponse>): NextResponse {
  return new NextResponse(texml.toString(), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  })
}

/** Absolute URL back to this route flagged as the gather gate, preserving the original params. */
function gateActionUrl(req: NextRequest): string {
  const qs = new URLSearchParams(req.nextUrl.searchParams)
  qs.set("g", "1")
  return `${getAppUrl().replace(/\/+$/, "")}/api/voice/telnyx/receptionist-answer?${qs.toString()}`
}

/** Read a DTMF digit Telnyx sends to the gather action (form body or query). */
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

function broadcastConnected(req: NextRequest) {
  const receptionistId = param(req, "r", "receptionistId")
  if (!receptionistId) return
  const callLogId = param(req, "cl", "callSid", "callLogId") ?? ""
  const businessType = normalizeBusinessType(param(req, "bt", "businessType"))
  const callerNumber = param(req, "from", "caller")
  const callerName = param(req, "cn", "callerName")
  const businessName = param(req, "bn", "businessName")
  after(async () => {
    try {
      await handleCallConnected({ receptionistId, callLogId, businessType, callerNumber, callerName, businessName })
    } catch (e) {
      console.error("[receptionist-answer] broadcast failed:", e)
    }
  })
}

async function respond(req: NextRequest): Promise<NextResponse> {
  const isGate = param(req, "g") === "1"
  const businessName = param(req, "bn", "businessName") || "your business"

  // --- Gate leg: the agent just pressed (or timed out on) the screen prompt. ---
  if (isGate) {
    const digit = await readPressedDigit(req)
    const texml = new VoiceResponse()
    if (digit === "1") {
      // Accepted → pop the HUD and return empty TeXML so Telnyx bridges the caller.
      broadcastConnected(req)
      return xmlResponse(texml)
    }
    // Declined / wrong key → release THIS leg so the caller falls to the next fallback.
    texmlSayWhisperPlain(texml, "No connection made. Releasing the call.")
    texml.hangup()
    return xmlResponse(texml)
  }

  // --- Screening disabled: legacy behaviour (broadcast now, optional whisper, immediate bridge). ---
  if (PRESS1_SCREEN_DISABLED) {
    broadcastConnected(req)
    const texml = new VoiceResponse()
    const phrase = whisperPhrase(req)
    if (phrase) texmlSayWhisperPlain(texml, phrase)
    return xmlResponse(texml)
  }

  // --- Initial answer with screening on: prompt "Press 1 to connect". ---
  const texml = new VoiceResponse()
  const gather = texml.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 10,
    action: gateActionUrl(req),
    method: "POST",
  })
  gather.say(
    getTexmlSayVoiceAttributes(),
    `Lyncr Alert. Incoming call for ${businessName}. Press 1 to connect.`
  )
  // No key within the window → hang up this leg only (caller continues down the fallback chain).
  texmlSayWhisperPlain(texml, "No input received. Goodbye.")
  texml.hangup()
  return xmlResponse(texml)
}

export async function GET(req: NextRequest) {
  return respond(req)
}

export async function POST(req: NextRequest) {
  return respond(req)
}
