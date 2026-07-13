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

/** Dashboard "AI Voice Persona" options → stored engine model ids. */
export const IVR_VOICE_PERSONA_OPTIONS = [
  {
    id: "en-US-Standard-C",
    label: "Reassuring Female",
    description: "Calm, clear female tone (default).",
    texmlVoice: "Polly.Joanna-Neural",
  },
  {
    id: "en-US-Standard-B",
    label: "Professional Male",
    description: "Steady male tone for business callers.",
    texmlVoice: "Polly.Matthew-Neural",
  },
  {
    id: "en-US-Standard-E",
    label: "Friendly",
    description: "Warm, approachable female tone.",
    texmlVoice: "Polly.Salli-Neural",
  },
] as const

export type IvrVoicePersonaId = (typeof IVR_VOICE_PERSONA_OPTIONS)[number]["id"]

/** Map stored engine model → TeXML <Say voice="…"> (Telnyx/Polly). */
export function resolveIvrTexmlVoice(engineModel: string | null | undefined): string {
  const raw = String(engineModel || "")
    .trim()
  if (!raw) return IVR_VOICE_PERSONA_OPTIONS[0].texmlVoice
  // Already a Polly / alice-style voice — pass through.
  if (/^(Polly\.|Google\.|alice|man|woman)/i.test(raw)) return raw
  const match = IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === raw)
  if (match) return match.texmlVoice
  return IVR_VOICE_PERSONA_OPTIONS[0].texmlVoice
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
