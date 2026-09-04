// Telnyx Call Control REST actions (answer → speak → dial → record → hold queue).

import { ensureTelnyxElevenLabsIntegrationSecret } from "@/lib/elevenlabs-telnyx"
import {
  elevenLabsNaturalHdFallback,
  elevenLabsSpeakRuntimeAllowed,
  getElevenLabsVoiceSettings,
  markElevenLabsSpeakFailed,
  normalizeElevenLabsCallControlVoice,
  preferWorkingSpeakVoice,
} from "@/lib/elevenlabs-voices"
import { lyncrLog } from "@/lib/lyncr-env"
import {
  buildCallControlSpeakPayload,
  CALL_CONTROL_POLLY_NEURAL_FALLBACK,
  getCallControlSpeakVoiceAttributes,
} from "@/lib/texml-say-voice"
import { telnyxHeaders } from "@/lib/telnyx-config"
import { normalizeTelnyxAssistantIdForTexml } from "@/lib/telnyx-ai-texml"

const TELNYX_CALLS_BASE = "https://api.telnyx.com/v2/calls"
const TELNYX_API_BASE = "https://api.telnyx.com/v2"

export type TelnyxCallControlActionResult =
  | { ok: true; callControlId?: string; alreadyTerminal?: boolean }
  | { ok: false; status: number; error: string }

/** Telnyx: call already ended — further commands return 422 / code 90018. */
const TELNYX_CALL_NO_LONGER_ACTIVE_CODE = "90018"

/** Short-lived memory of legs we know are done — skips duplicate hangup / leave_queue. */
const knownTerminalCallControlIds = new Map<string, number>()
const TERMINAL_CALL_TTL_MS = 15 * 60 * 1000

function pruneKnownTerminalCallControls(now = Date.now()): void {
  for (const [id, expiresAt] of knownTerminalCallControlIds) {
    if (expiresAt <= now) knownTerminalCallControlIds.delete(id)
  }
}

export function markTelnyxCallControlTerminal(callControlId: string): void {
  const id = callControlId.trim()
  if (!id) return
  pruneKnownTerminalCallControls()
  knownTerminalCallControlIds.set(id, Date.now() + TERMINAL_CALL_TTL_MS)
}

export function isTelnyxCallControlKnownTerminal(callControlId: string): boolean {
  const id = callControlId.trim()
  if (!id) return false
  const expiresAt = knownTerminalCallControlIds.get(id)
  if (expiresAt == null) return false
  if (expiresAt <= Date.now()) {
    knownTerminalCallControlIds.delete(id)
    return false
  }
  return true
}

/** True when Telnyx rejected a command because the leg is already over (race / duplicate). */
export function isTelnyxCallNoLongerActiveError(
  status: number,
  errBody: unknown,
  detail: string
): boolean {
  if (status !== 422 && status !== 400 && status !== 409) return false
  const errors = (errBody as { errors?: Array<{ code?: string | number; detail?: string }> } | null)
    ?.errors
  if (Array.isArray(errors)) {
    for (const err of errors) {
      if (String(err?.code ?? "") === TELNYX_CALL_NO_LONGER_ACTIVE_CODE) return true
      if (/no longer active/i.test(String(err?.detail ?? ""))) return true
    }
  }
  return /no longer active/i.test(detail) || detail.includes(TELNYX_CALL_NO_LONGER_ACTIVE_CODE)
}

async function postCallAction(
  callControlId: string,
  action: string,
  body: Record<string, unknown>
): Promise<TelnyxCallControlActionResult> {
  const id = callControlId.trim()
  if (!id) return { ok: false, status: 400, error: "missing call_control_id" }

  // Hangup / leave_queue after the leg is gone — skip the Telnyx POST (idempotent).
  if (
    (action === "hangup" || action === "leave_queue") &&
    isTelnyxCallControlKnownTerminal(id)
  ) {
    console.info(
      lyncrLog("telnyx-cc-api-skip-terminal", {
        action,
        callControlId: id,
        reason: "known_terminal",
      })
    )
    return { ok: true, alreadyTerminal: true }
  }

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
    if (action === "hangup") markTelnyxCallControlTerminal(id)
    return { ok: true }
  }
  const errBody = await res.json().catch(() => ({}))
  const detail =
    (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
    JSON.stringify(errBody).slice(0, 240)
  const terminalRace = isTelnyxCallNoLongerActiveError(res.status, errBody, detail || res.statusText)
  if (terminalRace) {
    markTelnyxCallControlTerminal(id)
    // Expected race: webhook hangup / duplicate leave after the leg already ended.
    console.warn(
      lyncrLog("telnyx-cc-api-already-terminal", {
        action,
        callControlId: id,
        status: res.status,
        error: detail || res.statusText,
        telnyxCode: TELNYX_CALL_NO_LONGER_ACTIVE_CODE,
      })
    )
    // Hangup / leave_queue: treat as success so callers do not escalate. Other actions stay failed.
    if (action === "hangup" || action === "leave_queue") {
      return { ok: true, alreadyTerminal: true }
    }
    return { ok: false, status: res.status, error: detail || res.statusText }
  }
  // Full Telnyx error JSON (truncated) — required to debug silent hold / real 422s.
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

/**
 * Attach ElevenLabs voice_settings when Speak uses ElevenLabs.*.
 * Returns null when secret/circuit says skip — caller must use NaturalHD instead.
 */
async function speakBodyExtras(
  voice: string
): Promise<{ ok: true; extras: Record<string, unknown> } | { ok: false; reason: string }> {
  if (!/^ElevenLabs\./i.test(voice)) return { ok: true, extras: {} }
  if (!elevenLabsSpeakRuntimeAllowed()) {
    return { ok: false, reason: "elevenlabs_circuit_open" }
  }
  const secretOk = await ensureTelnyxElevenLabsIntegrationSecret()
  if (!secretOk) {
    markElevenLabsSpeakFailed("secret_unavailable")
    return { ok: false, reason: "secret_unavailable" }
  }
  return { ok: true, extras: { voice_settings: getElevenLabsVoiceSettings() } }
}

/** Speak TTS greeting on an active call leg (ElevenLabs / NaturalHD / Polly Neural). */
export async function telnyxCallControlSpeak(
  callControlId: string,
  text: string,
  clientState: string,
  opts?: { voice?: string | null }
): Promise<TelnyxCallControlActionResult> {
  // Persona / env → Call Control voice (AWS.Polly.* / Telnyx.NaturalHD.* / ElevenLabs.*).
  const attrs = getCallControlSpeakVoiceAttributes({ personaVoice: opts?.voice })
  // Circuit / kill-switch may already remap ElevenLabs → NaturalHD before we POST.
  const primaryVoice = preferWorkingSpeakVoice(
    /^ElevenLabs\./i.test(attrs.voice) ? normalizeElevenLabsCallControlVoice(attrs.voice) : attrs.voice
  )
  const trySpeak = async (voice: string) => {
    const built = buildCallControlSpeakPayload(text, voice)
    const extrasRes = await speakBodyExtras(voice)
    if (!extrasRes.ok) {
      return { ok: false as const, status: 503, error: extrasRes.reason }
    }
    return postCallAction(callControlId, "speak", {
      payload: built.payload,
      payload_type: built.payloadType,
      // Premium unlocks neural / NaturalHD / ElevenLabs quality (basic = robotic).
      service_level: "premium",
      voice,
      language: attrs.language,
      client_state: clientState,
      ...extrasRes.extras,
    })
  }
  const primary = await trySpeak(primaryVoice)
  if (primary.ok) return primary
  // ElevenLabs HTTP reject / secret skip — fall back to NaturalHD then Polly.
  if (/^ElevenLabs\./i.test(primaryVoice)) {
    markElevenLabsSpeakFailed(primary.error || "speak_http_failed")
    const fb = elevenLabsNaturalHdFallback(primaryVoice)
    console.warn(
      lyncrLog("telnyx-cc-speak-elevenlabs-fallback", {
        callControlId,
        error: primary.error,
        fallback: fb,
      })
    )
    const elevenFallback = await trySpeak(fb)
    if (elevenFallback.ok) return elevenFallback
    console.warn(
      lyncrLog("telnyx-cc-speak-naturalhd-fallback", {
        callControlId,
        error: elevenFallback.error,
        fallback: CALL_CONTROL_POLLY_NEURAL_FALLBACK,
      })
    )
    return trySpeak(CALL_CONTROL_POLLY_NEURAL_FALLBACK)
  }
  // NaturalHD may be unavailable on some Telnyx accounts — fall back to Polly Neural.
  if (/^Telnyx\.NaturalHD\./i.test(primaryVoice) && primaryVoice !== CALL_CONTROL_POLLY_NEURAL_FALLBACK) {
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
    /**
     * How many times Telnyx re-speaks the payload when no digit arrives.
     * Telnyx defaults to 3 — that made Busy greeting play three times before hold.
     * Soft-hold rempromts are our job; Busy stay-on-line must be try-once then music.
     */
    maximumTries?: number
    /** Saved AI Voice Persona → Call Control voice (optional). */
    voice?: string | null
  }
): Promise<TelnyxCallControlActionResult> {
  const attrs = getCallControlSpeakVoiceAttributes({ personaVoice: opts.voice })
  // Prefer NaturalHD immediately when ElevenLabs circuit is open (free-plan speak.failed).
  const primaryVoice = preferWorkingSpeakVoice(
    /^ElevenLabs\./i.test(attrs.voice) ? normalizeElevenLabsCallControlVoice(attrs.voice) : attrs.voice
  )
  const maxDigits = Math.max(1, Math.min(8, Math.floor(opts.maximumDigits ?? 1) || 1))
  // Default 1 — never rely on Telnyx’s 3× payload replay for Busy / hold.
  const maxTries = Math.max(1, Math.min(3, Math.floor(opts.maximumTries ?? 1) || 1))
  const tryGather = async (voice: string) => {
    const built = buildCallControlSpeakPayload(opts.text, voice)
    const extrasRes = await speakBodyExtras(voice)
    if (!extrasRes.ok) {
      return { ok: false as const, status: 503, error: extrasRes.reason }
    }
    console.log(
      lyncrLog("telnyx-cc-gather-speak-voice", {
        callControlId,
        voice,
        maximumTries: maxTries,
        textLen: opts.text.length,
        elevenLabs: Boolean(extrasRes.extras.voice_settings),
      })
    )
    return postCallAction(callControlId, "gather_using_speak", {
      payload: built.payload,
      payload_type: built.payloadType,
      service_level: "premium",
      voice,
      language: attrs.language,
      minimum_digits: 1,
      maximum_digits: maxDigits,
      // 1 = speak once; stay-on-line → gather.ended → our hold music (not 3 greets).
      maximum_tries: maxTries,
      // Interrupting digit ends gather early when maximum_digits is 1.
      terminating_digit: "#",
      valid_digits: opts.validDigits || "0123456789",
      timeout_millis: opts.timeoutMillis ?? 8000,
      inter_digit_timeout_millis: 3000,
      client_state: opts.clientState,
      ...extrasRes.extras,
    })
  }
  const primary = await tryGather(primaryVoice)
  if (primary.ok) return primary
  if (/^ElevenLabs\./i.test(primaryVoice)) {
    markElevenLabsSpeakFailed(primary.error || "gather_speak_http_failed")
    const fb = elevenLabsNaturalHdFallback(primaryVoice)
    console.warn(
      lyncrLog("telnyx-cc-gather-speak-elevenlabs-fallback", {
        callControlId,
        error: primary.error,
        fallback: fb,
      })
    )
    const elevenFallback = await tryGather(fb)
    if (elevenFallback.ok) return elevenFallback
    console.warn(
      lyncrLog("telnyx-cc-gather-speak-naturalhd-fallback", {
        callControlId,
        error: elevenFallback.error,
        fallback: CALL_CONTROL_POLLY_NEURAL_FALLBACK,
      })
    )
    return tryGather(CALL_CONTROL_POLLY_NEURAL_FALLBACK)
  }
  if (/^Telnyx\.NaturalHD\./i.test(primaryVoice) && primaryVoice !== CALL_CONTROL_POLLY_NEURAL_FALLBACK) {
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
 * Dial PSTN target and (optionally) bridge to the inbound caller when answered.
 * Telnyx uses POST /v2/calls (not /actions/dial) with link_to + bridge_on_answer.
 *
 * When `answeringMachineDetection` is set, keep `bridgeOnAnswer: false` so carrier
 * voicemail is not auto-bridged — wait for call.machine.*.detection.ended, then
 * bridge humans or hang up the B-leg and run missed-call fallback (e.g. hold).
 */
export async function telnyxCallControlDial(
  params: {
    connectionId: string
    inboundCallControlId: string
    toE164: string
    fromE164: string
    timeoutSecs: number
    clientState: string
    /** Default true (Lines Answer + plain owner dial). Set false when AMD guards the bridge. */
    bridgeOnAnswer?: boolean
    /**
     * Telnyx AMD mode: "detect" | "detect_beep" | "detect_words" | "greeting_end" | "premium" | …
     * Omit for no AMD (default — Lines Answer must stay fast).
     */
    answeringMachineDetection?: string
    /**
     * Optional Telnyx `answering_machine_detection_config` (classic detect knobs).
     * Use longer initial_silence / analysis windows so false "machine" does not cut rings short.
     */
    answeringMachineDetectionConfig?: Record<string, number>
  }
): Promise<TelnyxCallControlActionResult> {
  const connectionId = params.connectionId.trim()
  const inboundCallControlId = params.inboundCallControlId.trim()
  if (!connectionId) return { ok: false, status: 400, error: "missing connection_id" }
  if (!inboundCallControlId) return { ok: false, status: 400, error: "missing inbound call_control_id" }

  // Default: auto-bridge on answer (Answer from Lines + owner fallback that allows cell VM).
  const bridgeOnAnswer = params.bridgeOnAnswer !== false
  const amd = String(params.answeringMachineDetection ?? "").trim()

  const body: Record<string, unknown> = {
    connection_id: connectionId,
    to: params.toE164,
    from: params.fromE164,
    link_to: inboundCallControlId,
    bridge_on_answer: bridgeOnAnswer,
    timeout_secs: Math.min(Math.max(params.timeoutSecs, 8), 120),
    client_state: params.clientState,
  }
  // Carrier VM answers as "answered" — AMD tells us human vs machine before we bridge.
  if (amd) {
    body.answering_machine_detection = amd
    // Optional knobs (classic detect) — e.g. longer initial_silence so we don't kill rings at 3s.
    if (params.answeringMachineDetectionConfig && typeof params.answeringMachineDetectionConfig === "object") {
      body.answering_machine_detection_config = params.answeringMachineDetectionConfig
    }
  }

  const res = await fetch(TELNYX_CALLS_BASE, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify(body),
  })
  const resBody = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      (resBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
      JSON.stringify(resBody).slice(0, 240)
    return { ok: false, status: res.status, error: detail || res.statusText }
  }
  const outboundCallControlId = String(
    (resBody as { data?: { call_control_id?: string } })?.data?.call_control_id ?? ""
  ).trim()
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

/**
 * Attach a Telnyx AI Voice Assistant to a live Call Control leg — conversational, open-ended
 * (unlike `gather_using_speak`, which only collects structured digits/utterances).
 * Docs: https://developers.telnyx.com/api-reference/call-commands/start-ai-assistant
 * Fires `call.conversation.ended` when the assistant's conversation concludes; the leg stays
 * open afterward (no auto-hangup) unless the assistant invokes a hangup tool (none configured here).
 */
export async function telnyxCallControlStartAiAssistant(
  callControlId: string,
  params: { assistantId: string; clientState?: string }
): Promise<TelnyxCallControlActionResult> {
  const id = normalizeTelnyxAssistantIdForTexml(params.assistantId.trim())
  return postCallAction(callControlId, "ai_assistant_start", {
    assistant: { id },
    ...(params.clientState ? { client_state: params.clientState } : {}),
  })
}

/** Stop an active AI Assistant conversation on a leg (e.g. owner picked up from Lines mid-conversation). */
export async function telnyxCallControlStopAiAssistant(
  callControlId: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "ai_assistant_stop", {})
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
  if (isTelnyxCallNoLongerActiveError(res.status, errBody, detail || res.statusText)) {
    markTelnyxCallControlTerminal(id)
    console.warn(
      lyncrLog("telnyx-cc-api-already-terminal", {
        action: "client_state_update",
        callControlId: id,
        status: res.status,
        error: detail || res.statusText,
        telnyxCode: TELNYX_CALL_NO_LONGER_ACTIVE_CODE,
      })
    )
    return { ok: true, alreadyTerminal: true }
  }
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
    /** Clear any queued/playing audio before this clip (avoids stacked late starts). */
    stop?: "current" | "all"
  }
): Promise<TelnyxCallControlActionResult> {
  const body: Record<string, unknown> = {
    client_state: opts.clientState,
    cache_audio: true,
    // Always play on the inbound leg the caller is on.
    target_legs: "self",
  }
  const mediaName = String(opts.mediaName || "").trim()
  const playbackContent = String(opts.playbackContent || "").trim()
  const audioUrl = String(opts.audioUrl || "").trim()

  if (mediaName) {
    body.media_name = mediaName
  } else if (playbackContent) {
    body.playback_content = playbackContent
    body.audio_type = "wav"
  } else if (audioUrl) {
    body.audio_url = audioUrl
    if (/\.mp3(\?|$)/i.test(audioUrl)) body.audio_type = "mp3"
    else if (/\.wav(\?|$)/i.test(audioUrl)) body.audio_type = "wav"
  } else {
    return { ok: false, status: 400, error: "playback_start needs audioUrl, mediaName, or playbackContent" }
  }
  if (opts.loop !== undefined) body.loop = opts.loop
  if (opts.stop) body.stop = opts.stop
  return postCallAction(callControlId, "playback_start", body)
}

export async function telnyxCallControlPlaybackStop(
  callControlId: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "playback_stop", {})
}

/**
 * Cancel a pending gather (e.g. the hold-loop's music/reprompt gather) before bridging a
 * leg elsewhere. Note: this itself fires another call.gather.ended webhook — callers still
 * need a status guard in the handler, this alone does not make stale hold-loop events safe.
 */
export async function telnyxCallControlGatherStop(
  callControlId: string
): Promise<TelnyxCallControlActionResult> {
  return postCallAction(callControlId, "gather_stop", {})
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
    // Play the clip once per gather; our hold loop restarts music on timeout.
    maximum_tries: 1,
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
