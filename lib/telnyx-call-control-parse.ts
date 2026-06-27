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
  }
}
