// Client-safe ElevenLabs voice IDs + Call Control Speak string helpers.
// Keep this free of Telnyx/server imports — Greetings UI imports persona options that use it.

/** Default Mission Control secret identifier we create / reference. */
export const DEFAULT_TELNYX_ELEVENLABS_SECRET_ID = "lyncr_elevenlabs"

/** Preferred ElevenLabs model for phone IVR (matches Telnyx Speak docs). */
export const ELEVENLABS_SPEAK_MODEL_ID = "eleven_multilingual_v2"

/** Well-known public ElevenLabs voice IDs (Default catalog). */
export const ELEVENLABS_VOICE_IDS = {
  rachel: "21m00Tcm4TlvDq8ikWAM",
  bella: "EXAVITQu4vr4xnSDxMaL",
  adam: "pNInz6obpgDQGcFmaJgB",
} as const

/** Build Call Control Speak voice string: ElevenLabs.<model>.<voiceId>. */
export function elevenLabsCallControlVoice(
  voiceId: string,
  modelId: string = ELEVENLABS_SPEAK_MODEL_ID
): string {
  const id = String(voiceId || "").trim()
  const model = String(modelId || ELEVENLABS_SPEAK_MODEL_ID).trim() || ELEVENLABS_SPEAK_MODEL_ID
  return `ElevenLabs.${model}.${id}`
}

/**
 * In-memory circuit: after Telnyx `call.speak.failed` / secret errors, skip ElevenLabs
 * for the rest of this serverless instance so Busy always uses NaturalHD.
 * null = unknown (try), true = heard success once, false = prefer NaturalHD.
 */
let elevenLabsRuntimeOk: boolean | null = null

/** Ops kill switch — set LYNCR_ELEVENLABS_DISABLED=1 on Vercel until a paid ElevenLabs plan works. */
export function elevenLabsDisabledByEnv(): boolean {
  const v = String(process.env.LYNCR_ELEVENLABS_DISABLED || "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

/** True when we have a key/secret ref configured (does not mean Speak will succeed). */
export function elevenLabsSpeakEnabled(): boolean {
  if (elevenLabsDisabledByEnv()) return false
  return Boolean(
    String(process.env.ELEVENLABS_API_KEY || "").trim() ||
      String(process.env.TELNYX_ELEVENLABS_API_KEY_REF || "").trim()
  )
}

/** True when Call Control should attempt ElevenLabs.* (key present + circuit not open). */
export function elevenLabsSpeakRuntimeAllowed(): boolean {
  if (!elevenLabsSpeakEnabled()) return false
  if (elevenLabsRuntimeOk === false) return false
  return true
}

/** After `call.speak.failed` or secret create failure — prefer NaturalHD until cold start / success. */
export function markElevenLabsSpeakFailed(reason: string): void {
  elevenLabsRuntimeOk = false
  console.warn(
    JSON.stringify({
      lyncr: "elevenlabs-speak-circuit-open",
      reason: String(reason || "unknown").slice(0, 200),
    })
  )
}

/** Optional: reopen circuit after a proven ElevenLabs Speak (HTTP path is not enough). */
export function markElevenLabsSpeakSucceeded(): void {
  elevenLabsRuntimeOk = true
}

/** Test helper — reset circuit to unknown between Vitest cases. */
export function resetElevenLabsSpeakCircuitForTests(): void {
  elevenLabsRuntimeOk = null
}

/** Remap ElevenLabs.* → NaturalHD when the runtime circuit is open / env disabled. */
export function preferWorkingSpeakVoice(voice: string): string {
  const v = String(voice || "").trim()
  if (/^ElevenLabs\./i.test(v) && !elevenLabsSpeakRuntimeAllowed()) {
    return elevenLabsNaturalHdFallback(v)
  }
  return v
}

/** Mission Control secret identifier passed as voice_settings.api_key_ref. */
export function getTelnyxElevenLabsApiKeyRef(): string {
  const fromEnv = String(process.env.TELNYX_ELEVENLABS_API_KEY_REF || "").trim()
  return fromEnv || DEFAULT_TELNYX_ELEVENLABS_SECRET_ID
}

/** voice_settings object for Telnyx Speak / gather_using_speak. */
export function getElevenLabsVoiceSettings(): {
  type: "elevenlabs"
  api_key_ref: string
} {
  return {
    type: "elevenlabs",
    api_key_ref: getTelnyxElevenLabsApiKeyRef(),
  }
}

/** Map short / legacy names onto full ElevenLabs.<model>.<id> Speak voices. */
export function normalizeElevenLabsCallControlVoice(voice: string): string {
  const raw = String(voice || "").trim()
  if (!/^ElevenLabs\./i.test(raw)) return raw
  const parts = raw.split(".")
  // Already ElevenLabs.model.voiceId
  if (parts.length >= 3 && parts[2] && parts[2].length > 8) return raw
  // ElevenLabs.Rachel / ElevenLabs.Adam / ElevenLabs.Bella (legacy short form)
  const nameOrId = parts[parts.length - 1] || ""
  if (/^rachel$/i.test(nameOrId) || nameOrId === ELEVENLABS_VOICE_IDS.rachel) {
    return elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.rachel)
  }
  if (/^bella$/i.test(nameOrId) || nameOrId === ELEVENLABS_VOICE_IDS.bella) {
    return elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.bella)
  }
  if (/^adam$/i.test(nameOrId) || nameOrId === ELEVENLABS_VOICE_IDS.adam) {
    return elevenLabsCallControlVoice(ELEVENLABS_VOICE_IDS.adam)
  }
  // ElevenLabs.<voiceId> (model omitted) — add default model.
  if (parts.length === 2 && nameOrId.length > 8) {
    return elevenLabsCallControlVoice(nameOrId)
  }
  return raw
}

/** NaturalHD fallback for a failed / unavailable ElevenLabs voice. */
export function elevenLabsNaturalHdFallback(voice: string): string {
  const v = String(voice || "")
  if (/adam/i.test(v) || v.includes(ELEVENLABS_VOICE_IDS.adam)) {
    return "Telnyx.NaturalHD.albion"
  }
  return "Telnyx.NaturalHD.astra"
}
