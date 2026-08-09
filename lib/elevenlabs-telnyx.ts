// ElevenLabs ↔ Telnyx Call Control Speak helpers.
// Telnyx does NOT read Vercel env vars. It needs:
//   1) voice = ElevenLabs.<modelId>.<voiceId>
//   2) voice_settings = { type: "elevenlabs", api_key_ref: "<Mission Control secret id>" }
// We auto-create that integration secret from ELEVENLABS_API_KEY when possible.

import { lyncrLog } from "@/lib/lyncr-env"
import { telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_SECRETS_URL = "https://api.telnyx.com/v2/integration_secrets"

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

/** True when we should attempt ElevenLabs Speak (Vercel key and/or Telnyx secret ref). */
export function elevenLabsSpeakEnabled(): boolean {
  return Boolean(
    String(process.env.ELEVENLABS_API_KEY || "").trim() ||
      String(process.env.TELNYX_ELEVENLABS_API_KEY_REF || "").trim()
  )
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

let ensureSecretPromise: Promise<boolean> | null = null

/**
 * Ensure Telnyx Mission Control has an integration secret for ElevenLabs.
 * Creates `lyncr_elevenlabs` (or TELNYX_ELEVENLABS_API_KEY_REF) from ELEVENLABS_API_KEY.
 * If the secret already exists, treats that as success (cannot rotate token via create).
 */
export async function ensureTelnyxElevenLabsIntegrationSecret(): Promise<boolean> {
  const apiKeyRef = getTelnyxElevenLabsApiKeyRef()
  const token = String(process.env.ELEVENLABS_API_KEY || "").trim()
  // User already pasted the key in Mission Control under this identifier.
  if (!token) {
    return Boolean(String(process.env.TELNYX_ELEVENLABS_API_KEY_REF || "").trim())
  }
  if (process.env.TELNYX_ELEVENLABS_SKIP_AUTO_SECRET === "1") {
    return true
  }
  if (!process.env.TELNYX_API_KEY?.trim()) {
    console.warn(lyncrLog("elevenlabs-telnyx-secret-skip", { reason: "missing_telnyx_api_key" }))
    return false
  }
  if (!ensureSecretPromise) {
    ensureSecretPromise = createSecretOnce(apiKeyRef, token).finally(() => {
      // Allow a later retry after cold-start failures (keep success cached via flag).
    })
  }
  return ensureSecretPromise
}

let secretReady = false

async function createSecretOnce(identifier: string, token: string): Promise<boolean> {
  if (secretReady) return true
  try {
    const res = await fetch(TELNYX_SECRETS_URL, {
      method: "POST",
      headers: telnyxHeaders(),
      body: JSON.stringify({
        identifier,
        type: "bearer",
        token,
      }),
    })
    if (res.ok || res.status === 201) {
      secretReady = true
      console.log(lyncrLog("elevenlabs-telnyx-secret-created", { identifier }))
      return true
    }
    const errBody = await res.json().catch(() => ({}))
    const detail = JSON.stringify(errBody).toLowerCase()
    // Identifier already exists in Mission Control — Speak can use api_key_ref as-is.
    if (
      res.status === 409 ||
      res.status === 422 ||
      detail.includes("already") ||
      detail.includes("taken") ||
      detail.includes("duplicate") ||
      detail.includes("exists")
    ) {
      secretReady = true
      console.log(lyncrLog("elevenlabs-telnyx-secret-exists", { identifier, status: res.status }))
      return true
    }
    console.error(
      lyncrLog("elevenlabs-telnyx-secret-failed", {
        identifier,
        status: res.status,
        error: JSON.stringify(errBody).slice(0, 400),
      })
    )
    ensureSecretPromise = null
    return false
  } catch (e) {
    console.error(
      lyncrLog("elevenlabs-telnyx-secret-error", {
        identifier,
        error: e instanceof Error ? e.message : String(e),
      })
    )
    ensureSecretPromise = null
    return false
  }
}
