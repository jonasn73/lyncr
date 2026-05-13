// ============================================
// TeXML <Say> — less robotic TTS (Telnyx / TwiML-compatible)
// ============================================
// Default Twilio/Telnyx Say uses a basic engine; Polly *-Neural sounds more natural.
// Optional SSML <prosody rate="…"> slightly speeds delivery (see ZING_TEXML_SAY_RATE).

import { VoiceResponse } from "@/lib/telnyx"

/** Amazon Polly neural — widely supported on Telnyx TeXML; override with ZING_TEXML_SAY_VOICE. */
const DEFAULT_TEXML_SAY_VOICE = "Polly.Joanna-Neural"
const DEFAULT_TEXML_SAY_LANGUAGE = "en-US"

/** Twilio <Say> attributes (Telnyx accepts TwiML-compatible XML). */
export function getTexmlSayVoiceAttributes(): { voice: string; language: string } {
  const voice = process.env.ZING_TEXML_SAY_VOICE?.trim() || DEFAULT_TEXML_SAY_VOICE
  const language = process.env.ZING_TEXML_SAY_LANGUAGE?.trim() || DEFAULT_TEXML_SAY_LANGUAGE
  return { voice, language }
}

function parseProsodyRate(): number {
  const raw = process.env.ZING_TEXML_SAY_RATE?.trim()
  if (raw === "" || raw === "1" || raw === "off" || raw === "false") return 1
  const n = parseFloat(raw || "1.08")
  if (!Number.isFinite(n) || n < 0.85 || n > 1.35) return 1.08
  return n
}

/** Escape text embedded in SSML <prosody> (company names may include &). */
export function escapeXmlForSsml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Body for <Say>: plain text, or SSML prosody when rate ≠ 1 and ZING_TEXML_SAY_SSML is not disabled.
 * Neural Polly/Google voices accept SSML in Say content per Twilio docs.
 */
export function texmlSayMessageBody(plainText: string): string {
  if (process.env.ZING_TEXML_SAY_SSML === "0" || process.env.ZING_TEXML_SAY_SSML === "false") {
    return plainText
  }
  const rate = parseProsodyRate()
  if (rate === 1) return plainText
  return `<prosody rate="${rate}">${escapeXmlForSsml(plainText)}</prosody>`
}

/** Apply natural voice (+ optional prosody) to any TeXML `VoiceResponse`. */
export function texmlSayNatural(vr: InstanceType<typeof VoiceResponse>, plainText: string): void {
  const attrs = getTexmlSayVoiceAttributes()
  vr.say(attrs, texmlSayMessageBody(plainText))
}
