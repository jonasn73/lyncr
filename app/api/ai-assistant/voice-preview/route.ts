// ============================================
// POST /api/ai-assistant/voice-preview
// ============================================
// Uses Telnyx POST /v2/text-to-speech/speech (binary or JSON base64). Browser fallback only if that fails.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getTelnyxApiKey } from "@/lib/telnyx-config"
import { resolveAssistantVoice, telnyxSynthesizeSpeechPreview } from "@/lib/telnyx-voice-ai-api"

export const runtime = "nodejs"

export type VoicePreviewResponse =
  | {
      mode: "telnyx"
      mimeType: string
      base64: string
    }
  | {
      mode: "browser"
      notice: string
    }

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { text?: string; voice?: string }
  try {
    body = (await req.json()) as { text?: string; voice?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) {
    return NextResponse.json(
      { error: "Add an opening line (or use the default) before previewing." },
      { status: 400 }
    )
  }

  try {
    getTelnyxApiKey()
  } catch {
    return NextResponse.json(
      {
        mode: "browser" as const,
        notice:
          "Voice API key is not configured on the server — using your browser’s voice for preview. Add the key for cloud preview; live calls still need it.",
      },
      { status: 200 }
    )
  }

  const voice = resolveAssistantVoice(typeof body.voice === "string" ? body.voice : undefined)

  try {
    const { buffer, contentType } = await telnyxSynthesizeSpeechPreview(text, voice)
    const base64 = Buffer.from(buffer).toString("base64")
    const payload: VoicePreviewResponse = {
      mode: "telnyx",
      mimeType: contentType,
      base64,
    }
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TTS preview failed"
    console.warn("[POST /api/ai-assistant/voice-preview] Telnyx TTS unavailable, using browser fallback:", msg)
    const payload: VoicePreviewResponse = {
      mode: "browser",
      notice:
        "Cloud voice preview could not return audio (voice id, billing, or API error). Using your browser’s voice to check wording — live calls still use your saved assistant.",
    }
    return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  }
}
