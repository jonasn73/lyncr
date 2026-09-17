// Parse Telnyx Voice API v2 webhook envelopes into a flat event view.

import { decodeTelnyxCallControlState } from "@/lib/telnyx-call-control-state"
import { parseTelnyxCallDurationFromPayload } from "@/lib/telnyx-call-duration"

export type TelnyxVoiceWebhookEvent = {
  eventType: string
  eventId: string
  callControlId: string
  callSessionId: string
  from: string
  to: string
  direction: string
  hangupCause: string
  dialStatus: string
  startTime: string
  endTime: string
  occurredAt: string
  callDurationSeconds: number
  clientState: ReturnType<typeof decodeTelnyxCallControlState>
  /** Digits from call.gather.ended (Busy menu press 1 / 2). */
  digits: string
  /** gather.ended status: valid | timeout | call_hangup | cancelled | … */
  gatherStatus: string
  /**
   * Answering-machine detection result from call.machine.*.detection.ended
   * (human | machine | human_residence | human_business | not_sure | …).
   */
  amdResult: string
  /**
   * call.recording.saved's downloadable clip — Call Control delivers this on the
   * ACCOUNT's Call Control Application webhook (this same endpoint), not to any
   * per-call `recording_webhook_url` override passed to record_start. Requires a
   * Telnyx Bearer auth header to download (see transcribeTelnyxRecording).
   */
  recordingUrl: string
  /** Seconds recorded, when Telnyx includes start/end timestamps on the event. */
  recordingDurationSeconds: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function parseTelnyxVoiceWebhookEvent(body: Record<string, unknown>): TelnyxVoiceWebhookEvent | null {
  const data = asRecord(body.data)
  if (!data) return null
  const payload = asRecord(data.payload)
  if (!payload) return null
  const callControlId = String(payload.call_control_id ?? "").trim()
  if (!callControlId) return null
  const rawClientState = String(payload.client_state ?? "").trim() || null
  const recordingUrls = asRecord(payload.recording_urls) ?? asRecord(payload.public_recording_urls)
  const recordingUrl = String(recordingUrls?.mp3 ?? recordingUrls?.wav ?? "").trim()
  const recordingStartedAtMs = Date.parse(String(payload.recording_started_at ?? ""))
  const recordingEndedAtMs = Date.parse(String(payload.recording_ended_at ?? ""))
  const recordingDurationSeconds =
    Number.isFinite(recordingStartedAtMs) && Number.isFinite(recordingEndedAtMs) && recordingEndedAtMs > recordingStartedAtMs
      ? Math.round((recordingEndedAtMs - recordingStartedAtMs) / 1000)
      : 0
  return {
    eventType: String(data.event_type ?? "").trim().toLowerCase(),
    eventId: String(data.id ?? "").trim(),
    callControlId,
    callSessionId: String(payload.call_session_id ?? "").trim(),
    from: String(payload.from ?? "").trim(),
    to: String(payload.to ?? "").trim(),
    direction: String(payload.direction ?? "").trim().toLowerCase(),
    hangupCause: String(payload.hangup_cause ?? payload.cause ?? "").trim().toLowerCase(),
    dialStatus: String(payload.status ?? payload.dial_status ?? "").trim().toLowerCase(),
    startTime: String(payload.start_time ?? "").trim(),
    endTime: String(payload.end_time ?? "").trim(),
    occurredAt: String(data.occurred_at ?? payload.occurred_at ?? "").trim(),
    callDurationSeconds: parseTelnyxCallDurationFromPayload(payload),
    clientState: decodeTelnyxCallControlState(rawClientState),
    digits: String(payload.digits ?? payload.Digits ?? "").trim(),
    gatherStatus: String(payload.status ?? payload.gather_status ?? "").trim().toLowerCase(),
    amdResult: String(payload.result ?? "").trim().toLowerCase(),
    recordingUrl,
    recordingDurationSeconds,
  }
}
