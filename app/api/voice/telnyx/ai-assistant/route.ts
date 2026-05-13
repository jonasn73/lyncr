// ============================================
// POST /api/voice/telnyx/ai-assistant (legacy URL)
// ============================================
// Previously: TeXML <Gather> + Vercel AI SDK loop (generic “receptionist”).
// Legacy URL: forwards to voicemail. Live AI fallback uses Telnyx <AIAssistant> from /api/voice/telnyx/fallback.

import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { texmlSayNatural } from "@/lib/texml-say-voice"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") || ""
  const callSid = req.nextUrl.searchParams.get("callSid") || ""
  const texml = new VoiceResponse()
  const appUrl = getAppUrl()

  texmlSayNatural(
    texml,
    "This number now uses our new voice assistant. It is not active on this call. Please leave your name, number, and how we can help after the tone."
  )
  texml.record({
    maxLength: 120,
    recordingStatusCallback: `${appUrl}/api/voice/telnyx/recording-status`,
    action: `${appUrl}/api/voice/telnyx/voicemail-complete?userId=${encodeURIComponent(userId)}&callSid=${encodeURIComponent(callSid)}`,
  })

  return new NextResponse(texml.toString(), {
    headers: { "Content-Type": "text/xml" },
  })
}
