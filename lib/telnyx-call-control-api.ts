// Telnyx Call Control REST actions (answer → speak → dial → record → hold queue).

import { lyncrLog } from "@/lib/lyncr-env"
import {
  buildCallControlSpeakPayload,
  CALL_CONTROL_POLLY_NEURAL_FALLBACK,
  getCallControlSpeakVoiceAttributes,
} from "@/lib/texml-say-voice"
import { telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_CALLS_BASE = "https://api.telnyx.com/v2/calls"
const TELNYX_API_BASE = "https://api.telnyx.com/v2"

export type TelnyxCallControlActionResult =
  | { ok: true; callControlId?: string }
  | { ok: false; status: number; error: string }

async function postCallAction(
  callControlId: string,
  action: string,
  body: Record<string, unknown>
): Promise<TelnyxCallControlActionResult> {
  const id = callControlId.trim()
  if (!id) return { ok: false, status: 400, error: "missing call_control_id" }
  // Surface media URLs / media_name in logs so silent hold music is diagnosable.
  const audioUrl = typeof body.audio_url === "string" ? body.audio_url : undefined
  const mediaName = typeof body.media_name === "string" ? body.media_name : undefined
  const hasPlaybackContent = typeof body.playback_content === "string" && body.playback_content.length > 0
  console.log(
    lyncrLog("telnyx-cc-api-post", {
      action,
      callControlId: id,
      audioUrl: audioUrl || undefined,
      mediaName: mediaName || undefined,
      playbackContent: hasPlaybackContent ? `base64:${String(body.playback_content).length}chars` : undefined,
      voice: typeof body.voice === "string" ? body.voice : undefined,
      apiKeyPrefix: String(process.env.TELNYX_API_KEY || "").slice(0, 12) || "(missing)",
    })
  )
  const res = await fetch(`${TELNYX_CALLS_BASE}/${encodeURIComponent(id)}/actions/${action}`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify(body),
  })
  if (res.ok) {
    console.log(
      lyncrLog("telnyx-cc-api-ok", {
        action,
        callControlId: id,
        audioUrl: audioUrl || undefined,
        mediaName: mediaName || undefined,
        playbackContent: hasPlaybackContent || undefined,
      })
    )
    return { ok: true }
  }
  const errBody = await res.json().catch(() => ({}))
  const detail =
    (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
    JSON.stringify(errBody).slice(0, 240)
  // Full Telnyx error JSON (truncated) — required to debug silent hold / 422s.
  console.error(
    lyncrLog("telnyx-cc-api-failed", {
      action,
      callControlId: id,
      status: res.status,
      error: detail || res.statusText,
      audioUrl: audioUrl || undefined,
      mediaName: mediaName || undefined,
      telnyxErrors: JSON.stringify(errBody).slice(0, 1200),
    })
  )
  return { ok: false, status: res.status, error: detail || res.statusText }
}

/** Answer inbound leg immediately — no nested speak/play in this request. */
export async function telnyxCallControlAnswer(
  callControlId: string,
  clientState: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "answer", { client_state: clientState })
}

/** Speak TTS greeting on an active call leg (NaturalHD / Polly Neural by default). */
export async function telnyxCallControlSpeak(
  callControlId: string,
  text: string,
  clientState: string,
  opts?: { voice?: string | null }
): Promise<TelnyxCallControlActionResult> {
  // Persona / env → Call Control voice (AWS.Polly.* / Telnyx.NaturalHD.* / ElevenLabs.*).
  const attrs = getCallControlSpeakVoiceAttributes({ personaVoice: opts?.voice })
  const trySpeak = async (voice: string) => {
    const built = buildCallControlSpeakPayload(text, voice)
    return postCallAction(callControlId, "speak", {
      payload: built.payload,
      payload_type: built.payloadType,
      // Premium unlocks neural / NaturalHD quality (basic = robotic).
      service_level: "premium",
      voice,
      language: attrs.language,
      client_state: clientState,
    })
  }
  const primary = await trySpeak(attrs.voice)
  if (primary.ok) return primary
  // ElevenLabs needs API key / Telnyx integration — fall back to NaturalHD.
  if (/^ElevenLabs\./i.test(attrs.voice)) {
    const fb = /adam/i.test(attrs.voice) ? "Telnyx.NaturalHD.albion" : "Telnyx.NaturalHD.astra"
    console.warn(
      lyncrLog("telnyx-cc-speak-elevenlabs-fallback", {
        callControlId,
        error: primary.error,
        fallback: fb,
      })
    )
    const elevenFallback = await trySpeak(fb)
    if (elevenFallback.ok) return elevenFallback
  }
  // NaturalHD may be unavailable on some Telnyx accounts — fall back to Polly Neural.
  if (/^Telnyx\.NaturalHD\./i.test(attrs.voice) && attrs.voice !== CALL_CONTROL_POLLY_NEURAL_FALLBACK) {
    console.warn(
      lyncrLog("telnyx-cc-speak-naturalhd-fallback", {
        callControlId,
        error: primary.error,
        fallback: CALL_CONTROL_POLLY_NEURAL_FALLBACK,
      })
    )
    return trySpeak(CALL_CONTROL_POLLY_NEURAL_FALLBACK)
  }
  return primary
}

/**
 * Speak a menu prompt and collect DTMF (Busy booking menu).
 * Webhooks: call.dtmf.received (optional), call.gather.ended with digits + status.
 */
export async function telnyxCallControlGatherUsingSpeak(
  callControlId: string,
  opts: {
    text: string
    clientState: string
    /** Max digits to collect (1 for press-1, or bypass code length). */
    maximumDigits?: number
    /** Milliseconds to wait after speak for a digit (TeXML uses ~8s). */
    timeoutMillis?: number
    validDigits?: string
    /** Saved AI Voice Persona → Call Control voice (optional). */
    voice?: string | null
  }
): Promise<TelnyxCallControlActionResult> {
  const attrs = getCallControlSpeakVoiceAttributes({ personaVoice: opts.voice })
  const maxDigits = Math.max(1, Math.min(8, Math.floor(opts.maximumDigits ?? 1) || 1))
  const tryGather = async (voice: string) => {
    const built = buildCallControlSpeakPayload(opts.text, voice)
    return postCallAction(callControlId, "gather_using_speak", {
      payload: built.payload,
      payload_type: built.payloadType,
      service_level: "premium",
      voice,
      language: attrs.language,
      minimum_digits: 1,
      maximum_digits: maxDigits,
      // Interrupting digit ends gather early when maximum_digits is 1.
      terminating_digit: "#",
      valid_digits: opts.validDigits || "0123456789",
      timeout_millis: opts.timeoutMillis ?? 8000,
      inter_digit_timeout_millis: 3000,
      client_state: opts.clientState,
    })
  }
  const primary = await tryGather(attrs.voice)
  if (primary.ok) return primary
  if (/^ElevenLabs\./i.test(attrs.voice)) {
    const fb = /adam/i.test(attrs.voice) ? "Telnyx.NaturalHD.albion" : "Telnyx.NaturalHD.astra"
    console.warn(
      lyncrLog("telnyx-cc-gather-speak-elevenlabs-fallback", {
        callControlId,
        error: primary.error,
        fallback: fb,
      })
    )
    const elevenFallback = await tryGather(fb)
    if (elevenFallback.ok) return elevenFallback
  }
  if (/^Telnyx\.NaturalHD\./i.test(attrs.voice) && attrs.voice !== CALL_CONTROL_POLLY_NEURAL_FALLBACK) {
    console.warn(
      lyncrLog("telnyx-cc-gather-speak-naturalhd-fallback", {
        callControlId,
        error: primary.error,
        fallback: CALL_CONTROL_POLLY_NEURAL_FALLBACK,
      })
    )
    return tryGather(CALL_CONTROL_POLLY_NEURAL_FALLBACK)
  }
  return primary
}

/**
 * Dial PSTN target and bridge to the inbound caller when answered.
 * Telnyx uses POST /v2/calls (not /actions/dial) with link_to + bridge_on_answer.
 */
export async function telnyxCallControlDial(
  params: {
    connectionId: string
    inboundCallControlId: string
    toE164: string
    fromE164: string
    timeoutSecs: number
    clientState: string
  }
): Promise<TelnyxCallControlActionResult> {
  const connectionId = params.connectionId.trim()
  const inboundCallControlId = params.inboundCallControlId.trim()
  if (!connectionId) return { ok: false, status: 400, error: "missing connection_id" }
  if (!inboundCallControlId) return { ok: false, status: 400, error: "missing inbound call_control_id" }

  const res = await fetch(TELNYX_CALLS_BASE, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      connection_id: connectionId,
      to: params.toE164,
      from: params.fromE164,
      link_to: inboundCallControlId,
      bridge_on_answer: true,
      timeout_secs: Math.min(Math.max(params.timeoutSecs, 8), 120),
      client_state: params.clientState,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      (body as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
      JSON.stringify(body).slice(0, 240)
    return { ok: false, status: res.status, error: detail || res.statusText }
  }
  const outboundCallControlId = String((body as { data?: { call_control_id?: string } })?.data?.call_control_id ?? "").trim()
  return { ok: true, callControlId: outboundCallControlId || undefined }
}

/** Start voicemail recording after the spoken prompt. */
export async function telnyxCallControlRecordStart(
  callControlId: string,
  clientState: string,
  webhookUrl: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "record_start", {
    format: "mp3",
    channels: "single",
    client_state: clientState,
    recording_track: "both",
    recording_webhook_url: webhookUrl,
  })
}

export async function telnyxCallControlHangup(callControlId: string): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "hangup", {})
}

/** List live Call Control legs on a connection (used to kill phantom ringing by session). */
export async function telnyxListActiveCalls(
  connectionId: string
): Promise<Array<{ callControlId: string; callSessionId: string }>> {
  const id = connectionId.trim()
  if (!id) return []
  const res = await fetch(`${TELNYX_API_BASE}/connections/${encodeURIComponent(id)}/active_calls`, {
    method: "GET",
    headers: telnyxHeaders(),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    console.warn(
      lyncrLog("telnyx-cc-list-active-calls-failed", {
        status: res.status,
        error:
          (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
          JSON.stringify(errBody).slice(0, 200),
      })
    )
    return []
  }
  const body = await res.json().catch(() => ({}))
  const rows = Array.isArray((body as { data?: unknown }).data) ? (body as { data: Record<string, unknown>[] }).data : []
  return rows
    .map((row) => ({
      callControlId: String(row.call_control_id ?? "").trim(),
      callSessionId: String(row.call_session_id ?? "").trim(),
    }))
    .filter((r) => r.callControlId)
}

/**
 * Persist client_state on a live leg so later webhooks (e.g. call.hangup) know the companion dial ID.
 * Telnyx uses PUT …/actions/client_state_update (not POST).
 */
export async function telnyxCallControlClientStateUpdate(
  callControlId: string,
  clientState: string
): Promise<TelnyxCallControlActionResult> {
  const id = callControlId.trim()
  if (!id) return { ok: false, status: 400, error: "missing call_control_id" }
  console.log(
    lyncrLog("telnyx-cc-api-post", {
      action: "client_state_update",
      callControlId: id,
      apiKeyPrefix: String(process.env.TELNYX_API_KEY || "").slice(0, 12) || "(missing)",
    })
  )
  const res = await fetch(`${TELNYX_CALLS_BASE}/${encodeURIComponent(id)}/actions/client_state_update`, {
    method: "PUT",
    headers: telnyxHeaders(),
    body: JSON.stringify({ client_state: clientState }),
  })
  if (res.ok) {
    console.log(lyncrLog("telnyx-cc-api-ok", { action: "client_state_update", callControlId: id }))
    return { ok: true }
  }
  const errBody = await res.json().catch(() => ({}))
  const detail =
    (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
    JSON.stringify(errBody).slice(0, 240)
  console.error(
    lyncrLog("telnyx-cc-api-failed", {
      action: "client_state_update",
      callControlId: id,
      status: res.status,
      error: detail || res.statusText,
    })
  )
  return { ok: false, status: res.status, error: detail || res.statusText }
}

/** Park an inbound leg on hold (Call Control) — used for secondary-ring intercept. */
export async function telnyxCallControlHold(callControlId: string): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "hold", {})
}

/**
 * Start hold music on an answered call (Telnyx contact-center pattern).
 * Prefer one of: audioUrl, mediaName (Telnyx Media Storage), or playbackContent (base64).
 * Do not mix audio_url + media_name in one request.
 */
export async function telnyxCallControlPlaybackStart(
  callControlId: string,
  opts: {
    audioUrl?: string | null
    /** Telnyx Media Storage name (POST /v2/media). */
    mediaName?: string | null
    /** Base64-encoded MP3/WAV — bypasses URL fetch from Telnyx → your host. */
    playbackContent?: string | null
    clientState: string
    /** "infinity" loops until stop; omit / number for finite plays. */
    loop?: "infinity" | number
  }
): Promise<TelnyxCallControlActionResult> {
  const body: Record<string, unknown> = {
    client_state: opts.clientState,
    cache_audio: true,
  }
  const mediaName = String(opts.mediaName || "").trim()
  const playbackContent = String(opts.playbackContent || "").trim()
  const audioUrl = String(opts.audioUrl || "").trim()

  if (mediaName) {
    body.media_name = mediaName
  } else if (playbackContent) {
    body.playback_content = playbackContent
  } else if (audioUrl) {
    body.audio_url = audioUrl
    if (/\.mp3(\?|$)/i.test(audioUrl)) body.audio_type = "mp3"
    else if (/\.wav(\?|$)/i.test(audioUrl)) body.audio_type = "wav"
  } else {
    return { ok: false, status: 400, error: "playback_start needs audioUrl, mediaName, or playbackContent" }
  }
  if (opts.loop !== undefined) body.loop = opts.loop
  return postCallAction(callControlId, "playback_start", body)
}

export async function telnyxCallControlPlaybackStop(
  callControlId: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "playback_stop", {})
}

/**
 * Play a clip and collect DTMF — secondary path; prefer playback_start + gather for hold music.
 * Webhook: call.gather.ended (digits or timeout). Production saw gatherStatus=invalid in ~1s
 * with 16 kHz MPEG-2 MP3 — use 8 kHz WAV URLs if you must use this path.
 */
export async function telnyxCallControlGatherUsingAudio(
  callControlId: string,
  opts: {
    audioUrl: string
    clientState: string
    timeoutMillis?: number
    maximumDigits?: number
    validDigits?: string
  }
): Promise<TelnyxCallControlActionResult> {
  const maxDigits = Math.max(1, Math.min(8, Math.floor(opts.maximumDigits ?? 1) || 1))
  return postCallAction(callControlId, "gather_using_audio", {
    audio_url: opts.audioUrl,
    minimum_digits: 1,
    maximum_digits: maxDigits,
    // No terminating_digit — "#" was ending gather oddly on some legs.
    valid_digits: opts.validDigits || "0123456789",
    timeout_millis: opts.timeoutMillis ?? 45_000,
    inter_digit_timeout_millis: 5000,
    client_state: opts.clientState,
  })
}

/**
 * Collect DTMF without speaking (music already playing via playback_start).
 * Webhook: call.gather.ended — same handler as gather_using_*.
 */
export async function telnyxCallControlGather(
  callControlId: string,
  opts: {
    clientState: string
    timeoutMillis?: number
    maximumDigits?: number
    validDigits?: string
  }
): Promise<TelnyxCallControlActionResult> {
  const maxDigits = Math.max(1, Math.min(8, Math.floor(opts.maximumDigits ?? 1) || 1))
  return postCallAction(callControlId, "gather", {
    minimum_digits: 1,
    maximum_digits: maxDigits,
    terminating_digit: "#",
    valid_digits: opts.validDigits || "0123456789",
    timeout_millis: opts.timeoutMillis ?? 45_000,
    inter_digit_timeout_millis: 3000,
    initial_timeout_millis: opts.timeoutMillis ?? 45_000,
    client_state: opts.clientState,
  })
}

/** Put caller into Telnyx native queue (Phase B). Music / gather still run separately. */
export async function telnyxCallControlEnqueue(
  callControlId: string,
  opts: {
    queueName: string
    maxWaitTimeSecs?: number
    clientState?: string
  }
): Promise<TelnyxCallControlActionResult> {
  const body: Record<string, unknown> = {
    queue_name: opts.queueName,
  }
  if (opts.maxWaitTimeSecs != null) body.max_wait_time_secs = opts.maxWaitTimeSecs
  if (opts.clientState) body.client_state = opts.clientState
  return postCallAction(callControlId, "enqueue", body)
}

/** Remove caller from any Telnyx queue (press 1 / hangup / SMS leave). */
export async function telnyxCallControlLeaveQueue(
  callControlId: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "leave_queue", {})
}

/**
 * Bridge this leg to another call_control_id OR to the head of a named queue.
 * Answer-from-Lines: dial agent → on answer bridge({ queue }) or bridge({ call_control_id }).
 */
export async function telnyxCallControlBridge(
  callControlId: string,
  opts: {
    queue?: string
    callControlId?: string
    clientState?: string
  }
): Promise<TelnyxCallControlActionResult> {
  const body: Record<string, unknown> = {}
  if (opts.queue?.trim()) body.queue = opts.queue.trim()
  if (opts.callControlId?.trim()) body.call_control_id = opts.callControlId.trim()
  if (opts.clientState) body.client_state = opts.clientState
  return postCallAction(callControlId, "bridge", body)
}
