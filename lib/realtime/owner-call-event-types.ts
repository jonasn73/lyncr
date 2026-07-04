// Typed payloads for owner-{userId} Pusher call telemetry events (client + server).

import { isMissedCallRecord } from "@/lib/missed-call-telemetry"

/** Fired when a new inbound call row is created (ringing). */
export type OwnerCallInitiatedPayload = {
  call_sid: string
  /** Neon call_logs.id — opens the intake sheet before the call is answered. */
  call_log_id?: string | null
  from_number?: string | null
  to_number?: string | null
  organization_id?: string | null
}

/** Fired when an inbound call is bridged / picked up — drives the intake sheet immediately. */
export type OwnerCallAnsweredPayload = {
  call_sid: string
  call_log_id: string
  from_number: string
  to_number?: string | null
  organization_id?: string | null
  answered_at?: string | null
}

/** Fired when a call reaches a terminal status (hangup / no-answer / etc.). */
export type OwnerCallCompletedPayload = {
  call_sid: string
  organization_id?: string | null
  to_number?: string | null
  from_number?: string | null
  /** Neon call_logs.id when available — drives answered-call intake popup. */
  call_log_id?: string | null
  /** Talk time in seconds (0 for missed / canceled). */
  duration_seconds?: number
  call_type?: string | null
  status?: string | null
  /** When absent on a completed inbound row, the owner never picked up live. */
  answered_at?: string | null
  ended_at?: string | null
  routed_to_name?: string | null
}

/** Fired when Telnyx posts a recording URL to call_logs — drives inline intake player. */
export type OwnerCallRecordingReadyPayload = {
  call_log_id: string
  recording_url: string
}

export type OwnerCallChannelEvent =
  | "call-initiated"
  | "call-answered"
  | "call-completed"
  | "call-recording-ready"

/** Normalize E.164 / display numbers to digits-only for workspace line matching. */
export function normalizeCallEventPhoneDigits(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  return digits
}

/** True when the terminal status should increment the missed-call counter. */
export function isMissedCallTelemetry(payload: OwnerCallCompletedPayload): boolean {
  return isMissedCallRecord({
    call_type: payload.call_type,
    status: payload.status,
    answered_at: payload.answered_at,
    ended_at: payload.ended_at,
    routed_to_name: payload.routed_to_name,
  })
}

/** Seconds to add to talk-time pills (answered conversations only). */
export function talkSecondsFromCompletedPayload(payload: OwnerCallCompletedPayload): number {
  if (isMissedCallTelemetry(payload)) return 0
  const sec = Number(payload.duration_seconds ?? 0)
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0
}
