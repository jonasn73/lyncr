// Shared rules for "missed call" — routing HUD, Pusher deltas, and call-history dialog.

export type MissedCallRecordInput = {
  call_type?: string | null
  status?: string | null
  /** When set, a completed row without answered_at was never picked up live. */
  answered_at?: string | null
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
    !input.answered_at &&
    (status === "completed" || status === "canceled" || status === "cancelled")
  ) {
    return true
  }

  return false
}
