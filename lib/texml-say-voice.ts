// ============================================
// TeXML <Say> + Call Control Speak — natural TTS
// ============================================
// TeXML accepts Twilio-style `Polly.*-Neural`. Call Control Speak needs `AWS.Polly.*-Neural`
// (or Azure / Telnyx / ElevenLabs). Sending bare `Polly.*` on Call Control often falls back
// to a basic robotic voice — that was the Key Squad Busy / Available greet issue.
// Optional SSML <prosody rate="…"> slightly speeds TeXML delivery (see LYNCR_TEXML_SAY_RATE).

import { normalizeElevenLabsCallControlVoice } from "@/lib/elevenlabs-voices"
import { VoiceResponse } from "@/lib/telnyx"
import { envLyncrOrZing } from "@/lib/lyncr-env"

/** Amazon Polly neural — TeXML `<Say voice="…">`; override with LYNCR_TEXML_SAY_VOICE. */
const DEFAULT_TEXML_SAY_VOICE = "Polly.Joanna-Neural"
/**
 * Call Control Speak default when no persona / env is set.
 * NaturalHD sounds more conversational on Busy gather than basic / robotic engines.
 * Override: `LYNCR_CALL_CONTROL_SPEAK_VOICE` (e.g. `AWS.Polly.Joanna-Neural`).
 */
const DEFAULT_CALL_CONTROL_SPEAK_VOICE = "Telnyx.NaturalHD.astra"
/** Polly neural fallback if NaturalHD is rejected by the account. */
export const CALL_CONTROL_POLLY_NEURAL_FALLBACK = "AWS.Polly.Joanna-Neural"
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

/**
 * Map a TeXML / legacy voice id into a Call Control Speak `voice` string.
 * - `Polly.Joanna-Neural` → `AWS.Polly.Joanna-Neural`
 * - `alice` / `man` / `woman` → NaturalHD astra (avoid robotic basic engine)
 * - Already-prefixed AWS / Azure / Telnyx / ElevenLabs / etc. pass through
 */
export function normalizeCallControlSpeakVoice(voice: string | null | undefined): string {
  const raw = String(voice ?? "").trim()
  if (!raw) return DEFAULT_CALL_CONTROL_SPEAK_VOICE
  // Already a Call Control provider voice — keep as-is.
  if (
    /^(AWS\.|Azure\.|ElevenLabs\.|Telnyx\.|Google\.|Minimax\.|Rime\.|Resemble\.|Inworld\.|FishAudio\.|xAI\.)/i.test(
      raw
    )
  ) {
    if (/^ElevenLabs\./i.test(raw)) return normalizeElevenLabsCallControlVoice(raw)
    return raw
  }
  // Twilio-style Polly on TeXML → AWS Polly on Call Control Speak.
  if (/^Polly\./i.test(raw)) {
    return `AWS.${raw.replace(/^Polly\./i, "Polly.")}`
  }
  // Basic TeXML engines sound robotic on phones — upgrade to NaturalHD.
  if (/^(alice|man|woman|male|female)$/i.test(raw)) {
    return DEFAULT_CALL_CONTROL_SPEAK_VOICE
  }
  return raw
}

/** Twilio <Say> attributes (Telnyx TeXML accepts TwiML-compatible XML). */
export function getTexmlSayVoiceAttributes(): { voice: string; language: string } {
  // Prefer LYNCR_*; legacy ZING_* still works until Vercel env is renamed.
  const voice = envLyncrOrZing("TEXML_SAY_VOICE") || DEFAULT_TEXML_SAY_VOICE
  const language = envLyncrOrZing("TEXML_SAY_LANGUAGE") || DEFAULT_TEXML_SAY_LANGUAGE
  return { voice, language }
}

/**
 * Call Control `speak` / `gather_using_speak` voice + language.
 *
 * Priority:
 * 1. `personaVoice` — saved AI Voice Persona from Greetings (`ivr_voice_engine_model`)
 * 2. `LYNCR_CALL_CONTROL_SPEAK_VOICE` (or legacy `ZING_*`) — ops override only when no persona
 * 3. Normalize `LYNCR_TEXML_SAY_VOICE`, else NaturalHD astra
 *
 * To force one voice for all accounts (ignore persona), set env AND leave persona unused,
 * or set `LYNCR_CALL_CONTROL_SPEAK_VOICE_FORCE=1` with the voice env.
 */
export function getCallControlSpeakVoiceAttributes(opts?: {
  /** Already-resolved Call Control voice from account persona (optional). */
  personaVoice?: string | null
}): { voice: string; language: string } {
  const language = envLyncrOrZing("TEXML_SAY_LANGUAGE") || DEFAULT_TEXML_SAY_LANGUAGE
  const forceEnv =
    envLyncrOrZing("CALL_CONTROL_SPEAK_VOICE_FORCE") === "1" ||
    envLyncrOrZing("CALL_CONTROL_SPEAK_VOICE_FORCE") === "true"
  const explicit = envLyncrOrZing("CALL_CONTROL_SPEAK_VOICE")
  if (forceEnv && explicit) {
    return { voice: normalizeCallControlSpeakVoice(explicit), language }
  }
  const persona = String(opts?.personaVoice || "").trim()
  if (persona) {
    return { voice: normalizeCallControlSpeakVoice(persona), language }
  }
  if (explicit) {
    return { voice: normalizeCallControlSpeakVoice(explicit), language }
  }
  const texmlVoice = envLyncrOrZing("TEXML_SAY_VOICE")
  if (texmlVoice) {
    return { voice: normalizeCallControlSpeakVoice(texmlVoice), language }
  }
  return { voice: DEFAULT_CALL_CONTROL_SPEAK_VOICE, language }
}

/**
 * Slightly conversational Busy speak rate for Polly SSML (1.0 = off).
 * NaturalHD ignores this (plain text). Override with `LYNCR_CALL_CONTROL_SPEAK_RATE`.
 */
export function getCallControlSpeakProsodyRate(): number {
  const raw = (envLyncrOrZing("CALL_CONTROL_SPEAK_RATE") ?? "1.05").trim()
  if (raw === "" || raw === "1" || raw === "off" || raw === "false") return 1
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n < 0.85 || n > 1.25) return 1.05
  return n
}

/** Build Speak payload — plain text, or SSML prosody for AWS Polly neural. */
export function buildCallControlSpeakPayload(
  plainText: string,
  voice: string
): { payload: string; payloadType: "text" | "ssml" } {
  const spoken = cleanTextForTTS(plainText)
  // NaturalHD / non-Polly: keep plain text (SSML can be read aloud on some engines).
  if (!/^AWS\.Polly\./i.test(voice)) {
    return { payload: spoken, payloadType: "text" }
  }
  if (envLyncrOrZing("CALL_CONTROL_SPEAK_SSML") === "0" || envLyncrOrZing("CALL_CONTROL_SPEAK_SSML") === "false") {
    return { payload: spoken, payloadType: "text" }
  }
  const rate = getCallControlSpeakProsodyRate()
  if (rate === 1) return { payload: spoken, payloadType: "text" }
  return {
    payload: `<speak><prosody rate="${rate}">${escapeXmlForSsml(spoken)}</prosody></speak>`,
    payloadType: "ssml",
  }
}

function parseProsodyRate(): number {
  // Coalesce missing env to "" so "unset" matches the empty branch below (optional `.trim()` alone yields `undefined`, which skipped that branch and forced rate 1.08 — Telnyx then spoke "<prosody …>" aloud).
  const raw = (envLyncrOrZing("TEXML_SAY_RATE") ?? "").trim()
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
  if (envLyncrOrZing("TEXML_SAY_SSML") === "0" || envLyncrOrZing("TEXML_SAY_SSML") === "false") {
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
