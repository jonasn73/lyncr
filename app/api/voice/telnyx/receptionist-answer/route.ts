// ============================================
// GET/POST /api/voice/telnyx/receptionist-answer
// ============================================
// Telnyx fetches this `<Number url="…" method="POST">` document the instant the callee leg
// answers (before bridging to the caller). We broadcast `call-answered` synchronously here
// so the owner CRM modal opens immediately — then return whisper / press-1 TeXML.

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

/** Owner intake sheet — fire the instant the callee leg answers (before press-1 gate). */
async function notifyOwnerCrmAnswered(req: NextRequest): Promise<void> {
  const callSid = resolveProviderCallSid(req)
  if (!callSid) return
  await notifyOwnerInboundCallAnswered({
    providerCallSid: callSid,
    ownerUserId: param(req, "u", "ownerUserId"),
    callLogId: param(req, "lid", "callLogId"),
    fromNumber: param(req, "from", "caller"),
    toNumber: param(req, "to"),
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

  if (isGate) {
    const digit = await readPressedDigit(req)
    if (digit === "1") {
      const receptionistId = param(req, "r", "receptionistId")
      if (receptionistId?.trim()) scheduleReceptionistHudConnected(req, receptionistId)
      return xmlResponseBody(buildReceptionistPress1AcceptedTexml())
    }
    return xmlResponseBody(buildReceptionistPress1RejectedTexml())
  }

  const receptionistId = param(req, "r", "receptionistId")
  if (!receptionistId?.trim()) {
    await notifyOwnerCrmAnswered(req)
    const texml = new VoiceResponse()
    const phrase = whisperPhrase(req)
    if (phrase) texmlSayWhisperPlain(texml, phrase)
    return xmlResponseBody(texml.toString())
  }

  // Owner CRM opens on answer; press-1 only gates bridging + receptionist HUD.
  await notifyOwnerCrmAnswered(req)

  if (PRESS1_SCREEN_DISABLED) {
    scheduleReceptionistHudConnected(req, receptionistId)
    const texml = new VoiceResponse()
    const phrase = whisperPhrase(req)
    if (phrase) texmlSayWhisperPlain(texml, phrase)
    return xmlResponseBody(texml.toString())
  }

  return xmlResponseBody(buildReceptionistPress1ScreenTexml(businessName, gateActionUrl(req)))
}

export async function GET(req: NextRequest) {
  return respond(req)
}

export async function POST(req: NextRequest) {
  return respond(req)
}
