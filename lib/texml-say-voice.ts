// ============================================
// TeXML <Say> — less robotic TTS (Telnyx / TwiML-compatible)
// ============================================
// Default Twilio/Telnyx Say uses a basic engine; Polly *-Neural sounds more natural.
// Optional SSML <prosody rate="…"> slightly speeds delivery (see ZING_TEXML_SAY_RATE).

import { VoiceResponse } from "@/lib/telnyx"

/** Amazon Polly neural — widely supported on Telnyx TeXML; override with ZING_TEXML_SAY_VOICE. */
const DEFAULT_TEXML_SAY_VOICE = "Polly.Joanna-Neural"
const DEFAULT_TEXML_SAY_LANGUAGE = "en-US"

/**
 * Phonetic TTS cleanup — keep DB / dashboard names as "Key Squad 502" (digit zero),
 * but speak them as "five oh two" so Polly/Telnyx don't say "five hundred two".
 * Call this immediately before any <Say> / AI voice engine input.
 */
export function cleanTextForTTS(text: string): string {
  // Work on a copy so callers keep the raw DB string for UI / logs.
  let out = String(text ?? "")
  // Longer brand phrases first so we don't leave a dangling "Key Squad" + partial replace.
  out = out.replace(/Key Squad 502/gi, "Key Squad five oh two")
  out = out.replace(/Key Squad 5-0-2/gi, "Key Squad five oh two")
  out = out.replace(/Key Squad 5[oO]2/gi, "Key Squad five oh two")
  // Standalone area-code style 502 (and hyphenated / letter-o typos).
  out = out.replace(/\b502\b/g, "five oh two")
  out = out.replace(/\b5-0-2\b/g, "five oh two")
  out = out.replace(/\b5[oO]2\b/g, "five oh two")
  return out
}

/** Twilio <Say> attributes (Telnyx accepts TwiML-compatible XML). */
export function getTexmlSayVoiceAttributes(): { voice: string; language: string } {
  const voice = process.env.ZING_TEXML_SAY_VOICE?.trim() || DEFAULT_TEXML_SAY_VOICE
  const language = process.env.ZING_TEXML_SAY_LANGUAGE?.trim() || DEFAULT_TEXML_SAY_LANGUAGE
  return { voice, language }
}

function parseProsodyRate(): number {
  // Coalesce missing env to "" so "unset" matches the empty branch below (optional `.trim()` alone yields `undefined`, which skipped that branch and forced rate 1.08 — Telnyx then spoke "<prosody …>" aloud).
  const raw = (process.env.ZING_TEXML_SAY_RATE ?? "").trim()
  if (raw === "" || raw === "1" || raw === "off" || raw === "false") return 1
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n < 0.85 || n > 1.35) return 1
  return n
}

/** Escape text embedded in SSML <prosody> (company names may include &). */
export function escapeXmlForSsml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Body for <Say>: phonetic cleanup, then plain text or SSML prosody when rate ≠ 1.
 * Neural Polly/Google voices accept SSML in Say content per Twilio docs.
 */
export function texmlSayMessageBody(plainText: string): string {
  // Always phoneticize before TTS — DB stays "502", speech becomes "five oh two".
  const spoken = cleanTextForTTS(plainText)
  if (process.env.ZING_TEXML_SAY_SSML === "0" || process.env.ZING_TEXML_SAY_SSML === "false") {
    return spoken
  }
  const rate = parseProsodyRate()
  if (rate === 1) return spoken
  return `<prosody rate="${rate}">${escapeXmlForSsml(spoken)}</prosody>`
}

/** Apply natural voice (+ optional prosody) to any TeXML `VoiceResponse`. */
export function texmlSayNatural(vr: InstanceType<typeof VoiceResponse>, plainText: string): void {
  const attrs = getTexmlSayVoiceAttributes()
  vr.say(attrs, texmlSayMessageBody(plainText))
}

/**
 * Short callee-only whisper: same neural voice as `texmlSayNatural` but **never** wraps SSML `<prosody>`.
 * Some carriers mishandle SSML on the `<Dial><Number url="…">` screen leg (double speak or odd routing).
 */
export function texmlSayWhisperPlain(vr: InstanceType<typeof VoiceResponse>, plainText: string): void {
  const attrs = getTexmlSayVoiceAttributes()
  // Whisper still needs phonetic 502 → five oh two when the brand is spoken.
  vr.say(attrs, cleanTextForTTS(plainText))
}
