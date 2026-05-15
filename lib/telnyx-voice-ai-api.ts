// ============================================
// Telnyx Voice AI Assistants — REST (server-only)
// ============================================
// Creates/updates assistants via your platform API key so users never open Mission Control.
// Docs: https://developers.telnyx.com/api-reference/assistants/create-an-assistant

import { telnyxHeaders } from "@/lib/telnyx-config"
import { SITE_NAME } from "@/lib/brand"

/** Telnyx v2 API base (same as number purchase routes). */
const TELNYX_BASE = "https://api.telnyx.com/v2"

/**
 * Default LLM when `TELNYX_AI_DEFAULT_MODEL` is unset.
 * Telnyx often rejects `openai/gpt-4o-mini` for Voice AI assistants — use a model they allow (see GET /v2/ai/models).
 */
const FALLBACK_MODEL = "openai/gpt-4o"

/** If the primary model is rejected for assistants, try these in order (skip duplicates). */
const ASSISTANT_MODEL_FALLBACKS = ["openai/gpt-4o", "google/gemini-2.5-flash"] as const

/** Models Telnyx rejects for Voice AI assistants — map to a safe id so updates don’t keep failing. */
const ASSISTANT_MODEL_ALIASES: Record<string, string> = {
  "openai/gpt-4o-mini": "openai/gpt-4o",
}

/** Default Telnyx TTS for Voice AI — NaturalHD is less robotic than Kokoro for receptionist-style speech. Override with TELNYX_AI_VOICE. */
const FALLBACK_VOICE = "Telnyx.NaturalHD.astra"

/** Read model id from env or use a safe default (remap legacy blocked ids). */
function defaultModel(): string {
  const raw = process.env.TELNYX_AI_DEFAULT_MODEL?.trim()
  if (!raw) return FALLBACK_MODEL
  return ASSISTANT_MODEL_ALIASES[raw] ?? raw
}

/** Read voice id from env or use Telnyx built-in default. */
function defaultVoice(): string {
  return process.env.TELNYX_AI_VOICE?.trim() || FALLBACK_VOICE
}

/**
 * Telnyx assistant `voice_settings`: slight `voice_speed` for Natural / NaturalHD / Kokoro;
 * `expressive_mode` for Ultra voices (Telnyx-only).
 */
export function buildVoiceSettingsForAssistant(voice: string): {
  voice: string
  voice_speed?: number
  expressive_mode?: boolean
} {
  const v = voice.trim()
  const out: { voice: string; voice_speed?: number; expressive_mode?: boolean } = { voice: v }
  if (/^Telnyx\.(NaturalHD|KokoroTTS|Natural\.)/i.test(v)) {
    const sp = parseFloat(process.env.TELNYX_AI_VOICE_SPEED || "1.08")
    if (Number.isFinite(sp) && sp >= 0.9 && sp <= 1.25) {
      out.voice_speed = sp
    }
  }
  if (v.includes("Telnyx.Ultra.")) {
    if (process.env.TELNYX_AI_EXPRESSIVE !== "0" && process.env.TELNYX_AI_EXPRESSIVE !== "false") {
      out.expressive_mode = true
    }
  }
  return out
}

/** User override wins; otherwise platform env / built-in default (used on create). */
export function resolveAssistantModel(override?: string | null | undefined): string {
  const t = override?.trim()
  if (t) return ASSISTANT_MODEL_ALIASES[t] ?? t
  return defaultModel()
}

/** User override wins; otherwise platform env / built-in default (used on create). */
export function resolveAssistantVoice(override?: string | null | undefined): string {
  const t = override?.trim()
  if (t) return t
  return defaultVoice()
}

/** Telnyx rejects extremely large payloads with opaque 5xx — stay under a conservative limit. */
const MAX_ASSISTANT_INSTRUCTIONS_CHARS = 120_000
const MAX_ASSISTANT_GREETING_CHARS = 2_000

/**
 * Turn Telnyx error JSON (or non-JSON) + HTTP status into one string for logs and UI toasts.
 * Many errors use `errors[].title` / `errors[].detail`, FastAPI uses `detail`, some use top-level `message`.
 */
function formatTelnyxErrorBody(body: unknown, httpStatus: number): string {
  const statusSuffix =
    httpStatus >= 500
      ? " Telnyx returned a server error (HTTP 5xx) — try again shortly; if it persists, check Telnyx status or your account limits."
      : ""

  const parts: string[] = []

  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>

    if (Array.isArray(o.errors)) {
      for (const item of o.errors) {
        if (!item || typeof item !== "object") continue
        const e = item as Record<string, unknown>
        const code = typeof e.code === "string" ? e.code.trim() : ""
        const title = typeof e.title === "string" ? e.title.trim() : ""
        const detail = typeof e.detail === "string" ? e.detail.trim() : ""
        const line = [code, title, detail].filter(Boolean).join(" — ")
        if (line) parts.push(line)
      }
    }

    const msg = o.message
    if (typeof msg === "string" && msg.trim()) parts.push(msg.trim())

    const errStr = o.error
    if (typeof errStr === "string" && errStr.trim()) parts.push(errStr.trim())

    const detail = o.detail
    if (typeof detail === "string" && detail.trim()) parts.push(detail.trim())
    if (Array.isArray(detail)) {
      for (const d of detail) {
        if (typeof d === "object" && d !== null && "msg" in d) {
          const m = (d as { msg?: string }).msg
          if (m) parts.push(String(m))
        } else if (typeof d === "string") parts.push(d)
      }
    }

    if (typeof o._nonJson === "string" && o._nonJson.trim()) {
      parts.push(`Non-JSON body: ${o._nonJson.trim().slice(0, 400)}`)
    }
  }

  const unique = [...new Set(parts.filter(Boolean))]
  let out = unique.join(" — ")

  const generic =
    !out ||
    /^an unexpected error occurred\.?$/i.test(out) ||
    (out.toLowerCase().includes("unexpected") && out.length < 80)
  if (generic) {
    const raw =
      body && typeof body === "object" ? JSON.stringify(body).slice(0, 900) : String(body).slice(0, 400)
    out =
      raw && raw !== "{}"
        ? `${raw} (HTTP ${httpStatus})${statusSuffix}`
        : `HTTP ${httpStatus} with no error details from Telnyx.${statusSuffix} Check Vercel logs for the full response body.`
  } else if (httpStatus >= 400) {
    out = `${out} (HTTP ${httpStatus})`
  }

  return out
}

/**
 * POST /v2/ai/assistants success body varies: OpenAPI shows the assistant at the JSON root (`{ id, name, … }`);
 * some responses may still wrap with `{ data: { id } }`.
 */
function extractAssistantIdFromCreateResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const o = body as Record<string, unknown>
  if (typeof o.id === "string" && o.id.trim()) return o.id.trim()
  if (typeof o.assistant_id === "string" && o.assistant_id.trim()) return o.assistant_id.trim()
  const data = o.data
  if (data && typeof data === "object") {
    const inner = data as Record<string, unknown>
    if (typeof inner.id === "string" && inner.id.trim()) return inner.id.trim()
    if (typeof inner.assistant_id === "string" && inner.assistant_id.trim()) return inner.assistant_id.trim()
    const nested = inner.data
    if (nested && typeof nested === "object" && typeof (nested as { id?: unknown }).id === "string") {
      const nid = String((nested as { id: string }).id).trim()
      if (nid) return nid
    }
  }
  return null
}

/** Shorten instructions/greeting so Telnyx is less likely to 500 on huge playbooks. */
function clampAssistantCreateFields(
  params: Pick<CreateTelnyxAssistantParams, "name" | "instructions" | "greeting">
): Pick<CreateTelnyxAssistantParams, "name" | "instructions" | "greeting"> {
  let instructions = params.instructions
  if (instructions.length > MAX_ASSISTANT_INSTRUCTIONS_CHARS) {
    console.warn(
      `[Sigo] Truncating assistant instructions from ${instructions.length} to ${MAX_ASSISTANT_INSTRUCTIONS_CHARS} for Telnyx create`
    )
    instructions =
      instructions.slice(0, MAX_ASSISTANT_INSTRUCTIONS_CHARS) +
      `\n\n[${SITE_NAME}: instructions truncated for Telnyx — shorten extra notes in AI call flow if needed]`
  }
  let greeting = params.greeting
  if (greeting.length > MAX_ASSISTANT_GREETING_CHARS) {
    console.warn(`[Sigo] Truncating greeting from ${greeting.length} to ${MAX_ASSISTANT_GREETING_CHARS}`)
    greeting = greeting.slice(0, MAX_ASSISTANT_GREETING_CHARS)
  }
  return { name: params.name.slice(0, 120), instructions, greeting }
}

export type CreateTelnyxAssistantParams = {
  /** Shown in Telnyx dashboard lists. */
  name: string
  /** System / playbook instructions. */
  instructions: string
  /** First thing the assistant says on connect. */
  greeting: string
  /** Optional — defaults from env or built-in. */
  model?: string
  /** Optional — defaults from env or built-in. */
  voice?: string
}

/**
 * POST /v2/ai/assistants — provision a new Voice AI assistant on your Telnyx account.
 * Returns Telnyx assistant id for TeXML <AIAssistant id="…">.
 * Retries with fallback models when Telnyx says the model is not available for AI assistants.
 */
export async function telnyxCreateAssistant(params: CreateTelnyxAssistantParams): Promise<{ id: string }> {
  const voice = params.voice || defaultVoice()
  const primary = params.model || defaultModel()
  const orderedModels = [primary, ...ASSISTANT_MODEL_FALLBACKS.filter((m) => m !== primary)]

  let lastError: Error | undefined

  const clamped = clampAssistantCreateFields({
    name: params.name,
    instructions: params.instructions,
    greeting: params.greeting,
  })

  for (const model of orderedModels) {
    const res = await fetch(`${TELNYX_BASE}/ai/assistants`, {
      method: "POST",
      headers: telnyxHeaders(),
      body: JSON.stringify({
        name: clamped.name,
        model,
        instructions: clamped.instructions,
        greeting: clamped.greeting,
        voice_settings: buildVoiceSettingsForAssistant(voice),
      }),
    })
    const rawText = await res.text()
    let body: unknown = {}
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText) as unknown
      } catch {
        body = { _nonJson: rawText.slice(0, 1200) }
      }
    }
    if (res.ok) {
      const id = extractAssistantIdFromCreateResponse(body)
      if (!id) {
        console.error("[Sigo] Telnyx create assistant 200 but unparseable id:", JSON.stringify(body).slice(0, 2500))
        throw new Error(
          "Telnyx create assistant succeeded but the response did not include an assistant id (unexpected JSON shape)."
        )
      }
      if (model !== primary) {
        console.log(`[Sigo] Telnyx assistant created with fallback model "${model}" (primary "${primary}" was rejected).`)
      }
      return { id }
    }

    console.error(`[Sigo] Telnyx POST /ai/assistants HTTP ${res.status}:`, rawText.slice(0, 5000))
    const detail = formatTelnyxErrorBody(body, res.status)
    lastError = new Error(`Telnyx create assistant failed: ${detail}`)
    const modelRejected =
      detail.includes("not available for AI Assistants") ||
      (detail.includes("not available") && detail.toLowerCase().includes("model"))
    if (!modelRejected) {
      throw lastError
    }
    console.warn(`[Sigo] Telnyx rejected assistant model "${model}", trying next…`, detail)
  }

  throw lastError ?? new Error("Telnyx create assistant failed")
}

export type UpdateTelnyxAssistantParams = {
  instructions?: string
  greeting?: string
  name?: string
  model?: string
  voice_settings?: ReturnType<typeof buildVoiceSettingsForAssistant>
}

/**
 * POST /v2/ai/assistants/{id} — push new instructions/greeting after user edits intake in HeySigo.
 */
export async function telnyxUpdateAssistant(
  assistantId: string,
  updates: UpdateTelnyxAssistantParams
): Promise<void> {
  const id = encodeURIComponent(assistantId.trim())
  const res = await fetch(`${TELNYX_BASE}/ai/assistants/${id}`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      ...updates,
      promote_to_main: true,
    }),
  })
  const rawText = await res.text()
  let body: unknown = {}
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText) as unknown
    } catch {
      body = { _nonJson: rawText.slice(0, 1200) }
    }
  }
  if (!res.ok) {
    console.error(`[Sigo] Telnyx POST /ai/assistants/${id} HTTP ${res.status}:`, rawText.slice(0, 4000))
    throw new Error(`Telnyx update assistant failed: ${formatTelnyxErrorBody(body, res.status)}`)
  }
}

const MAX_TTS_PREVIEW_CHARS = 1200

/**
 * Telnyx HTTP TTS for dashboard preview.
 * `POST /v2/text-to-speech` returns 404 on api.telnyx.com; the working route is **`POST /v2/text-to-speech/speech`**
 * (see Telnyx TTS docs — WebSocket is documented on GET /text-to-speech; HTTP generate uses `/speech`).
 */
export async function telnyxSynthesizeSpeechPreview(
  text: string,
  voice: string
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const clipped = text.trim().slice(0, MAX_TTS_PREVIEW_CHARS)
  if (!clipped) {
    throw new Error("No text to speak")
  }
  const voiceId = voice.trim() || defaultVoice()
  const res = await fetch(`${TELNYX_BASE}/text-to-speech/speech`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      text: clipped,
      voice: voiceId,
      output_type: "binary_output",
    }),
  })
  if (!res.ok) {
    const rawText = await res.text()
    let body: unknown = {}
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText) as unknown
      } catch {
        body = { _nonJson: rawText.slice(0, 600) }
      }
    }
    throw new Error(`Telnyx TTS failed: ${formatTelnyxErrorBody(body, res.status)}`)
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase()
  if (ct.includes("application/json")) {
    const j = (await res.json()) as { base64_audio?: string }
    const b64 = j.base64_audio
    if (typeof b64 !== "string" || !b64.trim()) {
      throw new Error("Telnyx TTS returned JSON without base64_audio")
    }
    const buf = Buffer.from(b64, "base64")
    return {
      buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      contentType: "audio/mpeg",
    }
  }

  const buffer = await res.arrayBuffer()
  return { buffer, contentType: res.headers.get("content-type") || "audio/mpeg" }
}
