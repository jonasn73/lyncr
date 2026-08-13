// IVR automation dispatch — voice personas, holiday window, bypass DTMF helpers.

import {
  ELEVENLABS_VOICE_IDS,
  elevenLabsCallControlVoice,
  elevenLabsNaturalHdFallback,
  elevenLabsSpeakEnabled,
  elevenLabsSpeakRuntimeAllowed,
  normalizeElevenLabsCallControlVoice,
  preferWorkingSpeakVoice,
} from "@/lib/elevenlabs-voices"
import {
  TELNYX_MENU_CLOSED_PROMPT,
  TELNYX_MENU_DEFAULT_RING_E164,
  TELNYX_MENU_ON_JOB_PROMPT,
} from "@/lib/telnyx-menu"

/**
 * Product default TTS model id when ElevenLabs is not configured.
 * Kept as NaturalHD Astra so deploys without ELEVENLABS_API_KEY stay unchanged.
 */
export const DEFAULT_IVR_VOICE_ENGINE_MODEL = "en-US-Standard-C"

/** Best ElevenLabs calm female — used as default when Speak can use ElevenLabs. */
export const ELEVENLABS_DEFAULT_IVR_VOICE_ENGINE_MODEL = "en-US-ElevenLabs-Rachel"

/** Hardcoded owner cell for secret bypass dial (presence blocks ignored). */
export const IVR_BYPASS_DIAL_E164 = TELNYX_MENU_DEFAULT_RING_E164

export const DEFAULT_ON_JOB_GREETING_TEXT = TELNYX_MENU_ON_JOB_PROMPT
export const DEFAULT_CLOSED_GREETING_TEXT = TELNYX_MENU_CLOSED_PROMPT

/**
 * Dashboard "AI Voice Persona" options → stored engine model ids.
 * Ordered best → worse for calm phone IVR.
 * ElevenLabs (★ Best) first — Call Control Speak uses Telnyx + Mission Control secret.
 * Without a key/secret, resolveSpeakVoiceForPersona falls back to NaturalHD.
 *
 * Call Control Speak uses `callControlVoice`. Persona wins over LYNCR_CALL_CONTROL_SPEAK_VOICE
 * unless that env is set to force an ops override (documented in PRODUCTION.md).
 */
export const IVR_VOICE_PERSONA_OPTIONS = [
  {
    id: "en-US-ElevenLabs-Rachel",
    // Owner-facing label: plain English only (engine id stays ElevenLabs under the hood).
    label: "★ Best · Calm woman",
    description: "Highest-quality calm female voice. Falls back automatically if needed.",
    texmlVoice: "Polly.Joanna-Neural",
    callControlVoice: elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.rachel),
    qualityRank: 0,
    requiresElevenLabs: true,
  },
  {
    id: "en-US-ElevenLabs-Bella",
    label: "★ Best · Warm woman",
    description: "Highest-quality warm female voice. Falls back automatically if needed.",
    texmlVoice: "Polly.Salli-Neural",
    callControlVoice: elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.bella),
    qualityRank: 0,
    requiresElevenLabs: true,
  },
  {
    id: "en-US-ElevenLabs-Adam",
    label: "★ Best · Calm man",
    description: "Highest-quality calm male voice. Falls back automatically if needed.",
    texmlVoice: "Polly.Matthew-Neural",
    callControlVoice: elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.adam),
    qualityRank: 0,
    requiresElevenLabs: true,
  },
  {
    id: "en-US-Standard-C",
    label: "Calm woman",
    description: "Calm, clear female voice for greetings and hold prompts.",
    texmlVoice: "Polly.Joanna-Neural",
    callControlVoice: "Telnyx.NaturalHD.astra",
    qualityRank: 1,
  },
  {
    id: "en-US-NaturalHD-Luna",
    label: "Soft woman",
    description: "Soft, clear female alternate for greetings and hold prompts.",
    texmlVoice: "Polly.Salli-Neural",
    callControlVoice: "Telnyx.NaturalHD.luna",
    qualityRank: 2,
  },
  {
    id: "en-US-NaturalHD-Albion",
    label: "Calm man",
    description: "Calm male voice for greetings and hold prompts.",
    texmlVoice: "Polly.Matthew-Neural",
    callControlVoice: "Telnyx.NaturalHD.albion",
    qualityRank: 3,
  },
  {
    id: "en-US-Polly-Joanna",
    label: "Steady woman",
    description: "Soft and steady female voice — solid everyday option.",
    texmlVoice: "Polly.Joanna-Neural",
    callControlVoice: "AWS.Polly.Joanna-Neural",
    qualityRank: 4,
  },
  {
    id: "en-US-Polly-Ruth",
    label: "Gentle woman",
    description: "Gentle, unhurried female voice.",
    texmlVoice: "Polly.Ruth-Neural",
    callControlVoice: "AWS.Polly.Ruth-Neural",
    qualityRank: 5,
  },
  {
    id: "en-US-Standard-E",
    label: "Friendly woman",
    description: "Bright, approachable female voice.",
    texmlVoice: "Polly.Salli-Neural",
    callControlVoice: "AWS.Polly.Salli-Neural",
    qualityRank: 6,
  },
  {
    id: "en-US-Standard-B",
    label: "Warm man",
    description: "Steady, businesslike male voice.",
    texmlVoice: "Polly.Matthew-Neural",
    callControlVoice: "AWS.Polly.Matthew-Neural",
    qualityRank: 7,
  },
  {
    id: "en-US-Polly-Stephen",
    label: "Clear man",
    description: "Clear, natural male voice.",
    texmlVoice: "Polly.Stephen-Neural",
    callControlVoice: "AWS.Polly.Stephen-Neural",
    qualityRank: 8,
  },
] as const

export type IvrVoicePersonaId = (typeof IVR_VOICE_PERSONA_OPTIONS)[number]["id"]

/** True when ElevenLabs can be attempted (Vercel key and/or Telnyx secret ref). */
export function elevenLabsKeyConfigured(): boolean {
  return elevenLabsSpeakEnabled()
}

/**
 * Default persona for new/empty account settings.
 * When ElevenLabs is wired, prefer Rachel; otherwise NaturalHD Astra.
 */
export function defaultIvrVoiceEngineModel(): string {
  return elevenLabsKeyConfigured()
    ? ELEVENLABS_DEFAULT_IVR_VOICE_ENGINE_MODEL
    : DEFAULT_IVR_VOICE_ENGINE_MODEL
}

/** Map stored engine model → TeXML <Say voice="…"> (Telnyx/Polly). */
export function resolveIvrTexmlVoice(engineModel: string | null | undefined): string {
  const raw = String(engineModel || "").trim()
  if (!raw) return IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === defaultIvrVoiceEngineModel())!.texmlVoice
  // Robotic basic engines → neural Joanna (same as Call Control normalize).
  if (/^(alice|man|woman|male|female)$/i.test(raw)) {
    return IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === DEFAULT_IVR_VOICE_ENGINE_MODEL)!.texmlVoice
  }
  // Already a Polly / Google voice — pass through.
  if (/^(Polly\.|Google\.|AWS\.Polly\.)/i.test(raw)) return raw
  // Legacy persona ids from older deploys.
  if (raw === "en-US-NaturalHD-Abbie") return "Polly.Salli-Neural"
  if (raw === "en-US-NaturalHD-Aiden") return "Polly.Stephen-Neural"
  const match = IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === raw)
  if (match) return match.texmlVoice
  return IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === DEFAULT_IVR_VOICE_ENGINE_MODEL)!.texmlVoice
}

/**
 * Map stored AI Voice Persona → Call Control Speak `voice`.
 * Prefer NaturalHD / AWS.Polly.*-Neural / ElevenLabs.<model>.<id> (never bare `alice`).
 */
export function resolveIvrCallControlVoice(engineModel: string | null | undefined): string {
  const raw = String(engineModel || "").trim()
  if (!raw) {
    const def = IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === defaultIvrVoiceEngineModel())
    return def?.callControlVoice || "Telnyx.NaturalHD.astra"
  }
  // Already a Call Control provider voice — keep as-is (with legacy NaturalHD / ElevenLabs renames).
  if (
    /^(AWS\.|Azure\.|ElevenLabs\.|Telnyx\.|Google\.|Minimax\.|Rime\.|Resemble\.|Inworld\.|FishAudio\.|xAI\.)/i.test(
      raw
    )
  ) {
    if (/^Telnyx\.NaturalHD\.abbie$/i.test(raw)) return "Telnyx.NaturalHD.luna"
    if (/^Telnyx\.NaturalHD\.aiden$/i.test(raw)) return "Telnyx.NaturalHD.albion"
    if (/^ElevenLabs\./i.test(raw)) return normalizeElevenLabsCallControlVoice(raw)
    return raw
  }
  // TeXML Polly → AWS Polly on Call Control.
  if (/^Polly\./i.test(raw)) {
    return `AWS.${raw.replace(/^Polly\./i, "Polly.")}`
  }
  if (/^(alice|man|woman|male|female)$/i.test(raw)) {
    return "Telnyx.NaturalHD.astra"
  }
  // Legacy persona ids → current Call Control voices.
  if (raw === "en-US-NaturalHD-Abbie") return "Telnyx.NaturalHD.luna"
  if (raw === "en-US-NaturalHD-Aiden") return "Telnyx.NaturalHD.albion"
  const match = IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === raw)
  if (match) return match.callControlVoice
  return "Telnyx.NaturalHD.astra"
}

/**
 * Resolve Speak voice for a saved persona.
 * ElevenLabs → NaturalHD when key missing, env disabled, or runtime circuit open
 * (Telnyx often returns HTTP 200 then `call.speak.failed` on free ElevenLabs plans).
 */
export function resolveSpeakVoiceForPersona(engineModel: string | null | undefined): string {
  const voice = resolveIvrCallControlVoice(engineModel)
  if (/^ElevenLabs\./i.test(voice)) {
    const normalized = normalizeElevenLabsCallControlVoice(voice)
    // Key missing / kill-switch / prior speak.failed → NaturalHD so callers never sit in silence.
    if (!elevenLabsSpeakRuntimeAllowed()) {
      return elevenLabsNaturalHdFallback(normalized)
    }
    return preferWorkingSpeakVoice(normalized)
  }
  return voice
}

export function normalizeIvrBypassCode(raw: unknown): string | null {
  if (raw == null) return null
  const digits = String(raw).replace(/\D/g, "")
  if (!digits) return null
  // Cap length so Gather stays usable; "1" conflicts with booking digit.
  return digits.slice(0, 8)
}

/** True when `digits` exactly match the configured bypass code. */
export function digitsMatchIvrBypass(
  digits: string | null | undefined,
  bypassCode: string | null | undefined
): boolean {
  const code = normalizeIvrBypassCode(bypassCode)
  if (!code) return false
  const pressed = String(digits || "").replace(/\D/g, "")
  return pressed.length > 0 && pressed === code
}

/** Gather numDigits: bypass length when set, otherwise 1 (Press 1 = SMS). */
export function resolveAutomationGatherNumDigits(bypassCode: string | null | undefined): number {
  const code = normalizeIvrBypassCode(bypassCode)
  if (!code) return 1
  return Math.max(1, Math.min(8, code.length))
}

export type HolidayOverrideFields = {
  holidayOverrideStart: string | null
  holidayOverrideEnd: string | null
  holidayGreetingText: string | null
}

/** True when `now` is inside the configured holiday window and greeting text exists. */
export function isHolidayOverrideActive(
  fields: HolidayOverrideFields,
  now: Date = new Date()
): boolean {
  const startRaw = fields.holidayOverrideStart
  const endRaw = fields.holidayOverrideEnd
  const text = typeof fields.holidayGreetingText === "string" ? fields.holidayGreetingText.trim() : ""
  if (!startRaw || !endRaw || !text) return false
  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
  if (end.getTime() < start.getTime()) return false
  const t = now.getTime()
  return t >= start.getTime() && t <= end.getTime()
}

/** Spoken holiday copy when override is active; otherwise null. */
export function resolveHolidayGreetingText(
  fields: HolidayOverrideFields,
  now: Date = new Date()
): string | null {
  if (!isHolidayOverrideActive(fields, now)) return null
  return String(fields.holidayGreetingText || "").trim() || null
}

/** Parse datetime-local / ISO strings into ISO for DB storage (null clears). */
export function parseHolidayDateTimeInput(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Format ISO for datetime-local input (local wall clock). */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
