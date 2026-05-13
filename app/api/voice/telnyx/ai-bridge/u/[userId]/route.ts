// ============================================
// GET/POST /api/voice/telnyx/ai-bridge/u/{userId}
// ============================================
// Second step after <Say><Redirect>: returns only <Connect><AIAssistant> for the same call leg.

import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { texmlSayNatural } from "@/lib/texml-say-voice"
import { getUser } from "@/lib/db"
import { ensureTelnyxVoiceAiAssistant } from "@/lib/telnyx-ai-assistant-lifecycle"
import { buildTelnyxAiAssistantTexml, normalizeTelnyxAssistantIdForTexml } from "@/lib/telnyx-ai-texml"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

type RouteCtx = { params: Promise<{ userId: string }> }

/** Read callSid from redirect URL query and, for POST, from the form body. */
async function parseCallSidFromRequest(req: NextRequest): Promise<string> {
  const url = new URL(req.url)
  const fromQuery = url.searchParams.get("callSid")?.trim() || ""
  if (fromQuery) return fromQuery
  if (req.method.toUpperCase() === "POST") {
    try {
      const fd = await req.clone().formData()
      const fromForm = String(fd.get("callSid") || fd.get("CallSid") || "").trim()
      if (fromForm) return fromForm
    } catch {
      /* ignore */
    }
  }
  return ""
}

async function handleAiBridge(req: NextRequest, userId: string): Promise<NextResponse> {
  const callSid = await parseCallSidFromRequest(req)

  console.log(
    JSON.stringify({
      zing: "telnyx-ai-bridge",
      userId,
      method: req.method,
    })
  )

  const user = await getUser(userId)
  if (!user) {
    const vr = new VoiceResponse()
    texmlSayNatural(vr, "We are sorry, this line is not available.")
    vr.hangup()
    return new NextResponse(vr.toString(), {
      headers: { "Content-Type": "text/xml" },
    })
  }

  let assistantId =
    user.telnyx_ai_assistant_id?.trim() || process.env.TELNYX_AI_ASSISTANT_ID?.trim() || ""
  if (!assistantId) {
    const ensured = await ensureTelnyxVoiceAiAssistant(userId)
    if (ensured.linked && ensured.assistantId?.trim()) {
      assistantId = ensured.assistantId.trim()
    }
  }

  if (!assistantId) {
    const appUrl = getAppUrl()
    const vr = new VoiceResponse()
    texmlSayNatural(
      vr,
      "Our voice assistant is not set up on this line yet. Please leave your name and number after the tone."
    )
    const sid = callSid || `zing-${userId.slice(0, 8)}`
    vr.record({
      maxLength: 120,
      recordingStatusCallback: `${appUrl}/api/voice/telnyx/recording-status`,
      action: `${appUrl}/api/voice/telnyx/voicemail-complete?userId=${encodeURIComponent(userId)}&callSid=${encodeURIComponent(sid)}`,
    })
    console.log(JSON.stringify({ zing: "telnyx-ai-bridge-no-assistant", userId }))
    return new NextResponse(vr.toString(), {
      headers: { "Content-Type": "text/xml" },
    })
  }

  const forTexml = normalizeTelnyxAssistantIdForTexml(assistantId)
  console.log(
    JSON.stringify({
      zing: "telnyx-ai-bridge-connect",
      userId,
      assistantIdLen: forTexml.length,
      texmlIdStartsWithAssistant: forTexml.toLowerCase().startsWith("assistant-"),
    })
  )

  return new NextResponse(buildTelnyxAiAssistantTexml(assistantId), {
    headers: { "Content-Type": "text/xml" },
  })
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { userId } = await ctx.params
  return handleAiBridge(req, userId)
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { userId } = await ctx.params
  return handleAiBridge(req, userId)
}
