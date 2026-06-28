// ============================================
// GET/POST /api/voice/telnyx/receptionist-answer
// ============================================
// Telnyx fetches this `<Number url="…" method="POST">` document the instant the receptionist's cell
// answers (before bridging to the caller). Press 1 to connect; wrong key / timeout hangs up this leg.

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

function resolveProviderCallSid(req: NextRequest): string {
  return param(req, "cl", "callSid", "callLogId") ?? ""
}

/** Owner CRM modal + optional receptionist HUD — fired the instant the PSTN/WebRTC leg answers. */
function scheduleAnsweredSideEffects(req: NextRequest, receptionistId?: string | null) {
  const callSid = resolveProviderCallSid(req)
  if (!callSid) return
  after(async () => {
    try {
      await notifyOwnerInboundCallAnswered({ providerCallSid: callSid })
    } catch (e) {
      console.error("[receptionist-answer] owner call-answered broadcast failed:", e)
    }
    if (receptionistId?.trim()) {
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
    }
  })
}

function broadcastConnected(req: NextRequest) {
  const receptionistId = param(req, "r", "receptionistId")
  scheduleAnsweredSideEffects(req, receptionistId)
}

async function respond(req: NextRequest): Promise<NextResponse> {
  const isGate = param(req, "g") === "1"
  const businessName = param(req, "bn", "businessName") || "your business"

  if (isGate) {
    const digit = await readPressedDigit(req)
    if (digit === "1") {
      broadcastConnected(req)
      return xmlResponseBody(buildReceptionistPress1AcceptedTexml())
    }
    return xmlResponseBody(buildReceptionistPress1RejectedTexml())
  }

  // Owner / admin override legs omit `r` — bridge immediately (no press-1 gate).
  const receptionistId = param(req, "r", "receptionistId")
  if (!receptionistId?.trim()) {
    scheduleAnsweredSideEffects(req, null)
    const texml = new VoiceResponse()
    const phrase = whisperPhrase(req)
    if (phrase) texmlSayWhisperPlain(texml, phrase)
    return xmlResponseBody(texml.toString())
  }

  if (PRESS1_SCREEN_DISABLED) {
    broadcastConnected(req)
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
