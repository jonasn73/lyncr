// Server-only: ensure Telnyx Mission Control has an ElevenLabs integration secret.
// Do not import this from client components — use lib/elevenlabs-voices.ts instead.

import { lyncrLog } from "@/lib/lyncr-env"
import {
  getTelnyxElevenLabsApiKeyRef,
} from "@/lib/elevenlabs-voices"
import { telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_SECRETS_URL = "https://api.telnyx.com/v2/integration_secrets"

let ensureSecretPromise: Promise<boolean> | null = null
let secretReady = false

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
    ensureSecretPromise = createSecretOnce(apiKeyRef, token)
  }
  return ensureSecretPromise
}

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

// Re-export voice helpers so server Call Control code can import one module if preferred.
export {
  DEFAULT_TELNYX_ELEVENLABS_SECRET_ID,
  ELEVENLABS_SPEAK_MODEL_ID,
  ELEVENLABS_VOICE_IDS,
  elevenLabsCallControlVoice,
  elevenLabsNaturalHdFallback,
  elevenLabsSpeakEnabled,
  getElevenLabsVoiceSettings,
  getTelnyxElevenLabsApiKeyRef,
  normalizeElevenLabsCallControlVoice,
} from "@/lib/elevenlabs-voices"
