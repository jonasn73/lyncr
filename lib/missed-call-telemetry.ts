// Shared rules for "missed call" — routing HUD, Pusher deltas, and call-history dialog.

export type MissedCallRecordInput = {
  call_type?: string | null
  status?: string | null
  /** Set when owner/receptionist bridged live on the call. */
  routed_to_name?: string | null
  /** When set, a completed row without answered_at was never picked up live. */
  answered_at?: string | null
  ended_at?: string | null
}

function normalizeCallType(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
}

function normalizeCallStatus(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
}

function ownerLiveAnswered(input: MissedCallRecordInput): boolean {
  const answeredAt = input.answered_at ? Date.parse(input.answered_at) : NaN
  const endedAt = input.ended_at ? Date.parse(input.ended_at) : NaN
  if (Number.isFinite(answeredAt) && Number.isFinite(endedAt) && endedAt - answeredAt >= 2000) {
    return true
  }
  // Inbound rows preset routed_to_name ("Owner", "AI Receptionist") before anyone picks up — ignore it here.
  return false
}

/**
 * True when nobody answered the business line live (includes voicemail after no-answer).
 * Matches the routing strip SQL in getDailyCallTelemetryForOwner.
 */
export function isMissedCallRecord(input: MissedCallRecordInput): boolean {
  const type = normalizeCallType(input.call_type)
  const status = normalizeCallStatus(input.status)

  if (type === "missed" || type === "voicemail") return true
  if (["no-answer", "busy", "missed", "canceled", "cancelled"].includes(status)) return true

  // Carrier marked completed but owner never bridged (early hangup or bad webhook ordering).
  if (
    type === "incoming" &&
    (status === "completed" || status === "canceled" || status === "cancelled") &&
    !ownerLiveAnswered(input)
  ) {
    return true
  }

  return false
}
