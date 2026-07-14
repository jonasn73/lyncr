// ============================================
// GET/POST /api/voice/telnyx/receptionist-answer
// ============================================
// Telnyx fetches this `<Number url="…" method="POST">` document the instant the callee leg
// answers (before bridging to the caller). Press-1 confirms a human — voicemail cannot press 1,
// so Lyncr keeps the call as missed and falls through to textback / native voicemail.

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
 * Confirmed human answer (press 1, or press-1 disabled).
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

  void updateCallLog(callSid, {
    call_type: "incoming",
    status: "in-progress",
    answered_at: new Date().toISOString(),
    ...(receptionistId?.trim() ? {} : { routed_to_name: OWNER_PHONE_ROUTED_TO_NAME }),
  }).catch((e) => {
    console.warn("[receptionist-answer] call-log answer tag failed:", e)
  })

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

/** Receptionist HUD — only after press-1 accept or when screening is off. */
function scheduleReceptionistHudConnected(req: NextRequest, receptionistId: string): void {
  const callSid = resolveProviderCallSid(req)
  if (!callSid) return
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

async function respond(req: NextRequest): Promise<NextResponse> {
  const isGate = param(req, "g") === "1"
  const businessName = param(req, "bn", "businessName") || "your business"
  const receptionistId = param(req, "r", "receptionistId")
  const phrase = whisperPhrase(req)

  // Gate callback — only digit 1 confirms a human (voicemail cannot press 1).
  if (isGate) {
    const digit = await readPressedDigit(req)
    if (digit === "1") {
      await notifyOwnerCrmAnswered(req)
      if (receptionistId?.trim()) scheduleReceptionistHudConnected(req, receptionistId)
      return xmlResponseBody(buildReceptionistPress1AcceptedTexml())
    }
    return xmlResponseBody(buildReceptionistPress1RejectedTexml())
  }

  // Escape hatch for debugging / accounts that want immediate bridge.
  if (PRESS1_SCREEN_DISABLED) {
    await notifyOwnerCrmAnswered(req)
    if (receptionistId?.trim()) scheduleReceptionistHudConnected(req, receptionistId)
    const texml = new VoiceResponse()
    if (phrase) texmlSayWhisperPlain(texml, phrase)
    return xmlResponseBody(texml.toString())
  }

  // Owner cell AND receptionist: press 1 before bridging (anti-voicemail).
  // Do NOT set answered_at yet — voicemail pickup must stay Missed.
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
