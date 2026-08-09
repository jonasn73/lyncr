// IVR automation dispatch — voice personas, holiday window, bypass DTMF helpers.

import {
  TELNYX_MENU_CLOSED_PROMPT,
  TELNYX_MENU_DEFAULT_RING_E164,
  TELNYX_MENU_ON_JOB_PROMPT,
} from "@/lib/telnyx-menu"

/** Product default TTS model id (stored on account_settings). */
export const DEFAULT_IVR_VOICE_ENGINE_MODEL = "en-US-Standard-C"

/** Hardcoded owner cell for secret bypass dial (presence blocks ignored). */
export const IVR_BYPASS_DIAL_E164 = TELNYX_MENU_DEFAULT_RING_E164

export const DEFAULT_ON_JOB_GREETING_TEXT = TELNYX_MENU_ON_JOB_PROMPT
export const DEFAULT_CLOSED_GREETING_TEXT = TELNYX_MENU_CLOSED_PROMPT

/**
 * Dashboard "AI Voice Persona" options → stored engine model ids.
 * Ordered best → worse for calm phone IVR (NaturalHD > Polly Neural).
 * ElevenLabs (when ELEVENLABS_API_KEY / Telnyx integration is set) ranks above NaturalHD —
 * see optional entries with requiresElevenLabs.
 *
 * Call Control Speak uses `callControlVoice`. Persona wins over LYNCR_CALL_CONTROL_SPEAK_VOICE
 * unless that env is set to force an ops override (documented in PRODUCTION.md).
 */
export const IVR_VOICE_PERSONA_OPTIONS = [
  {
    id: "en-US-Standard-C",
    label: "★ Best · Calm woman (NaturalHD Astra)",
    description: "Highest quality calm female without extra setup — Telnyx NaturalHD Astra.",
    texmlVoice: "Polly.Joanna-Neural",
    callControlVoice: "Telnyx.NaturalHD.astra",
    qualityRank: 1,
  },
  {
    id: "en-US-NaturalHD-Luna",
    label: "★ Calm woman (NaturalHD Luna)",
    description: "NaturalHD Luna — soft, clear female alternate.",
    texmlVoice: "Polly.Salli-Neural",
    callControlVoice: "Telnyx.NaturalHD.luna",
    qualityRank: 2,
  },
  {
    id: "en-US-NaturalHD-Albion",
    label: "★ Best · Calm man (NaturalHD Albion)",
    description: "Highest quality calm male without extra setup — Telnyx NaturalHD Albion.",
    texmlVoice: "Polly.Matthew-Neural",
    callControlVoice: "Telnyx.NaturalHD.albion",
    qualityRank: 3,
  },
  {
    id: "en-US-ElevenLabs-Rachel",
    label: "Premium · Calm woman (ElevenLabs Rachel)",
    description: "ElevenLabs — needs ELEVENLABS_API_KEY (or Telnyx ElevenLabs integration). Falls back to Astra if missing.",
    texmlVoice: "Polly.Joanna-Neural",
    callControlVoice: "ElevenLabs.Rachel",
    qualityRank: 0,
    requiresElevenLabs: true,
  },
  {
    id: "en-US-ElevenLabs-Adam",
    label: "Premium · Calm man (ElevenLabs Adam)",
    description: "ElevenLabs — needs ELEVENLABS_API_KEY. Falls back to Albion if missing.",
    texmlVoice: "Polly.Matthew-Neural",
    callControlVoice: "ElevenLabs.Adam",
    qualityRank: 0,
    requiresElevenLabs: true,
  },
  {
    id: "en-US-Polly-Joanna",
    label: "Calm woman (Polly Joanna Neural)",
    description: "AWS Polly Neural Joanna — soft and steady; solid fallback.",
    texmlVoice: "Polly.Joanna-Neural",
    callControlVoice: "AWS.Polly.Joanna-Neural",
    qualityRank: 4,
  },
  {
    id: "en-US-Polly-Ruth",
    label: "Gentle woman (Polly Ruth Neural)",
    description: "AWS Polly Neural Ruth — gentle, unhurried.",
    texmlVoice: "Polly.Ruth-Neural",
    callControlVoice: "AWS.Polly.Ruth-Neural",
    qualityRank: 5,
  },
  {
    id: "en-US-Standard-E",
    label: "Friendly woman (Polly Salli Neural)",
    description: "AWS Polly Neural Salli — bright and approachable.",
    texmlVoice: "Polly.Salli-Neural",
    callControlVoice: "AWS.Polly.Salli-Neural",
    qualityRank: 6,
  },
  {
    id: "en-US-Standard-B",
    label: "Warm man (Polly Matthew Neural)",
    description: "AWS Polly Neural Matthew — steady business tone.",
    texmlVoice: "Polly.Matthew-Neural",
    callControlVoice: "AWS.Polly.Matthew-Neural",
    qualityRank: 7,
  },
  {
    id: "en-US-Polly-Stephen",
    label: "Clear man (Polly Stephen Neural)",
    description: "AWS Polly Neural Stephen — clear and natural.",
    texmlVoice: "Polly.Stephen-Neural",
    callControlVoice: "AWS.Polly.Stephen-Neural",
    qualityRank: 8,
  },
] as const

export type IvrVoicePersonaId = (typeof IVR_VOICE_PERSONA_OPTIONS)[number]["id"]

/** True when ElevenLabs can be attempted (env key present). */
export function elevenLabsKeyConfigured(): boolean {
  return Boolean(String(process.env.ELEVENLABS_API_KEY || "").trim())
}

/** Map stored engine model → TeXML <Say voice="…"> (Telnyx/Polly). */
export function resolveIvrTexmlVoice(engineModel: string | null | undefined): string {
  const raw = String(engineModel || "").trim()
  if (!raw) return IVR_VOICE_PERSONA_OPTIONS[0].texmlVoice
  // Robotic basic engines → neural Joanna (same as Call Control normalize).
  if (/^(alice|man|woman|male|female)$/i.test(raw)) return IVR_VOICE_PERSONA_OPTIONS[0].texmlVoice
  // Already a Polly / Google voice — pass through.
  if (/^(Polly\.|Google\.|AWS\.Polly\.)/i.test(raw)) return raw
  // Legacy persona ids from older deploys.
  if (raw === "en-US-NaturalHD-Abbie") return "Polly.Salli-Neural"
  if (raw === "en-US-NaturalHD-Aiden") return "Polly.Stephen-Neural"
  const match = IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === raw)
  if (match) return match.texmlVoice
  return IVR_VOICE_PERSONA_OPTIONS[0].texmlVoice
}

/**
 * Map stored AI Voice Persona → Call Control Speak `voice`.
 * Prefer NaturalHD / AWS.Polly.*-Neural (never bare `alice` / basic engine).
 */
export function resolveIvrCallControlVoice(engineModel: string | null | undefined): string {
  const raw = String(engineModel || "").trim()
  if (!raw) return IVR_VOICE_PERSONA_OPTIONS[0].callControlVoice
  // Already a Call Control provider voice — keep as-is (with legacy NaturalHD renames).
  if (
    /^(AWS\.|Azure\.|ElevenLabs\.|Telnyx\.|Google\.|Minimax\.|Rime\.|Resemble\.|Inworld\.|FishAudio\.|xAI\.)/i.test(
      raw
    )
  ) {
    if (/^Telnyx\.NaturalHD\.abbie$/i.test(raw)) return "Telnyx.NaturalHD.luna"
    if (/^Telnyx\.NaturalHD\.aiden$/i.test(raw)) return "Telnyx.NaturalHD.albion"
    return raw
  }
  // Twilio-style Polly → AWS Polly on Call Control.
  if (/^Polly\./i.test(raw)) {
    return `AWS.${raw.replace(/^Polly\./i, "Polly.")}`
  }
  if (/^(alice|man|woman|male|female)$/i.test(raw)) {
    return IVR_VOICE_PERSONA_OPTIONS[0].callControlVoice
  }
  // Legacy persona ids → current Call Control voices.
  if (raw === "en-US-NaturalHD-Abbie") return "Telnyx.NaturalHD.luna"
  if (raw === "en-US-NaturalHD-Aiden") return "Telnyx.NaturalHD.albion"
  const match = IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === raw)
  if (match) return match.callControlVoice
  return IVR_VOICE_PERSONA_OPTIONS[0].callControlVoice
}

/**
 * Resolve Speak voice for a saved persona, with ElevenLabs → NaturalHD fallback when key missing.
 */
export function resolveSpeakVoiceForPersona(engineModel: string | null | undefined): string {
  const voice = resolveIvrCallControlVoice(engineModel)
  if (/^ElevenLabs\./i.test(voice) && !elevenLabsKeyConfigured()) {
    if (/adam/i.test(voice)) return "Telnyx.NaturalHD.albion"
    return "Telnyx.NaturalHD.astra"
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
