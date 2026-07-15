// Telnyx Call Control REST actions (answer → speak → dial → record).

import { getTexmlSayVoiceAttributes } from "@/lib/texml-say-voice"
import { telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_CALLS_BASE = "https://api.telnyx.com/v2/calls"

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
  console.log(
    JSON.stringify({
      zing: "telnyx-cc-api-post",
      action,
      callControlId: id,
      apiKeyPrefix: String(process.env.TELNYX_API_KEY || "").slice(0, 12) || "(missing)",
    })
  )
  const res = await fetch(`${TELNYX_CALLS_BASE}/${encodeURIComponent(id)}/actions/${action}`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify(body),
  })
  if (res.ok) {
    console.log(JSON.stringify({ zing: "telnyx-cc-api-ok", action, callControlId: id }))
    return { ok: true }
  }
  const errBody = await res.json().catch(() => ({}))
  const detail =
    (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
    JSON.stringify(errBody).slice(0, 240)
  console.error(
    JSON.stringify({
      zing: "telnyx-cc-api-failed",
      action,
      callControlId: id,
      status: res.status,
      error: detail || res.statusText,
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

/** Speak TTS greeting on an active call leg. */
export async function telnyxCallControlSpeak(
  callControlId: string,
  text: string,
  clientState: string
): Promise<TelnyxCallControlActionResult> {
  const attrs = getTexmlSayVoiceAttributes()
  return postCallAction(callControlId, "speak", {
    payload: text,
    payload_type: "text",
    voice: attrs.voice,
    language: attrs.language,
    client_state: clientState,
  })
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
    JSON.stringify({
      zing: "telnyx-cc-api-post",
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
    console.log(JSON.stringify({ zing: "telnyx-cc-api-ok", action: "client_state_update", callControlId: id }))
    return { ok: true }
  }
  const errBody = await res.json().catch(() => ({}))
  const detail =
    (errBody as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ||
    JSON.stringify(errBody).slice(0, 240)
  console.error(
    JSON.stringify({
      zing: "telnyx-cc-api-failed",
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
