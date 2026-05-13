// ============================================
// GET/POST /api/voice/telnyx/receptionist-screen
// ============================================
// Telnyx/TwiML: when `<Number url="…">` is used on outbound Dial, this URL is
// fetched after the callee answers. Returned TeXML plays only on their leg
// (whisper) before they are bridged to the original caller.
//
// **Before answer:** the callee usually sees the business DID as caller ID (set on `<Dial callerId>` in incoming).
// True spoken-ID *before* pickup is not something standard PSTN TeXML provides; CNAM varies by carrier.

import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse } from "@/lib/telnyx"
import { sanitizeWhisperPhrase } from "@/lib/inbound-line-whisper"
import { texmlSayNatural } from "@/lib/texml-say-voice"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

function phraseFromRequest(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get("p") || req.nextUrl.searchParams.get("phrase")
  if (raw == null || raw.trim() === "") return null
  try {
    const decoded = decodeURIComponent(raw)
    const cleaned = sanitizeWhisperPhrase(decoded)
    return cleaned.length > 0 ? cleaned : null
  } catch {
    return null
  }
}

function texmlForPhrase(phrase: string | null): string {
  const texml = new VoiceResponse()
  if (phrase) texmlSayNatural(texml, phrase)
  return texml.toString()
}

async function respond(req: NextRequest): Promise<NextResponse> {
  const phrase = phraseFromRequest(req)
  return new NextResponse(texmlForPhrase(phrase), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  })
}

export async function GET(req: NextRequest) {
  return respond(req)
}

export async function POST(req: NextRequest) {
  return respond(req)
}
