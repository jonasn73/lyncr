// Typed payloads for owner-{userId} Pusher call telemetry events (client + server).

import {
  isAnsweredFromQueueStatus,
  isHoldAutomationStatus,
} from "@/lib/inbound-time-capture"
import { isMissedCallRecord } from "@/lib/missed-call-telemetry"

/** Fired when a new inbound call row is created (ringing). */
export type OwnerCallInitiatedPayload = {
  call_sid: string
  /** Neon call_logs.id — opens the intake sheet before the call is answered. */
  call_log_id?: string | null
  from_number?: string | null
  to_number?: string | null
  organization_id?: string | null
  /**
   * When set, a teammate cell is ringing — owner dashboard should NOT open the full
   * “RINGING / Incoming Call” intake as if the owner phone were the Dial target.
   */
  routed_to_receptionist_id?: string | null
  /** Display name for the live Dial target (e.g. Alex Jonas). */
  routed_to_name?: string | null
  /**
   * Dial-plan reason from Call Control (e.g. busy_automation, day_dial, busy_backup_recv).
   * When busy_automation / hold path, owner Incoming Call sheet must stay closed.
   */
  dial_reason?: string | null
}

/**
 * True when the owner dashboard should open the full RINGING / New Intake sheet.
 * False for Busy→hold, press-1 automation, or teammate Dial (owner is not the ring target).
 */
export function shouldOpenOwnerRingingIntake(payload: {
  routed_to_receptionist_id?: string | null
  routed_to_name?: string | null
  dial_reason?: string | null
}): boolean {
  // Teammate cell is the Dial target.
  if (String(payload.routed_to_receptionist_id ?? "").trim()) return false
  const reason = String(payload.dial_reason ?? "")
    .trim()
    .toLowerCase()
  if (reason === "busy_automation" || reason === "queue_answer") return false
  const routed = String(payload.routed_to_name ?? "").trim().toLowerCase()
  if (!routed) return true
  // Hold / press-1 / busy menu tags — automation owns the caller, not the owner phone.
  if (routed === "hold queue" || routed.includes("hold menu") || routed.includes("booked from hold")) {
    return false
  }
  if (routed.includes("presence closed") || routed.includes("presence on-job") || routed.includes("presence on job")) {
    return false
  }
  if (routed.includes("sent night link") || routed.includes("sent day link") || routed.includes("sent busy link")) {
    return false
  }
  if (routed.includes("ivr") || routed.includes("voicemail") || routed.includes("ai receptionist")) {
    return false
  }
  return true
}

/**
 * True when CALL ANSWERED / New Intake should open after a bridge (or Answer from Lines).
 * False while the caller is only waiting on hold / Busy menu (same class as ringing suppress).
 */
export function shouldOpenOwnerAnsweredIntake(payload: {
  routed_to_name?: string | null
  dial_reason?: string | null
}): boolean {
  const reason = String(payload.dial_reason ?? "")
    .trim()
    .toLowerCase()
  // Owner/teammate tapped Answer on Lines and the bridge connected.
  if (reason === "queue_answer") return true
  if (isAnsweredFromQueueStatus(payload.routed_to_name)) return true
  // Soft-hold / Busy automation — still waiting; do not show CALL ANSWERED.
  if (reason === "busy_automation") return false
  if (isHoldAutomationStatus(payload.routed_to_name)) return false
  return true
}

/** Fired when an inbound call is bridged / picked up — drives the intake sheet immediately. */
export type OwnerCallAnsweredPayload = {
  call_sid: string
  call_log_id: string
  from_number: string
  to_number?: string | null
  organization_id?: string | null
  answered_at?: string | null
  /** Who owns the leg (Hold Queue vs Owner vs Answered from queue). */
  routed_to_name?: string | null
  /** Call Control dial reason — busy_automation must not open New Intake. */
  dial_reason?: string | null
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
