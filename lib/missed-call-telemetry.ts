// Shared rules for "missed call" — routing HUD, Pusher deltas, and call-history dialog.

import { isLocalCalendarToday } from "@/lib/daily-call-telemetry"

export type MissedCallRecordInput = {
  call_type?: string | null
  status?: string | null
  /** Set when owner/receptionist bridged live on the call. */
  routed_to_name?: string | null
  /** When set, a completed row without answered_at was never picked up live. */
  answered_at?: string | null
  ended_at?: string | null
}

/** Canonical label written to call_logs.routed_to_name for Smart IVR Menu. */
export const IVR_MENU_ROUTED_TO_NAME = "IVR Menu"

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
 * True when the call was handled by IVR / AI / voicemail — not a physical team member.
 * These must never count as green live "Answered" in Activities or missed metrics.
 */
export function isAutomatedCallHandler(routedToName: string | null | undefined): boolean {
  const n = String(routedToName ?? "")
    .trim()
    .toLowerCase()
  if (!n) return false
  if (n === "ivr menu" || n === "ivr") return true
  if (/\bivr\b/.test(n)) return true
  if (n.includes("smart overflow")) return true
  if (n.includes("voicemail")) return true
  if (n.includes("ai receptionist")) return true
  if (n.includes("voice ai")) return true
  if (n.includes("assistant") && !n.includes("human")) return true
  if (n.includes("keypad")) return true
  if (n.includes("menu") && (n.includes("ivr") || n.includes("overflow"))) return true
  return false
}

/** IVR / keypad menu path specifically (for Missed (IVR) badge + chronology copy). */
export function isIvrMenuHandler(routedToName: string | null | undefined): boolean {
  const n = String(routedToName ?? "")
    .trim()
    .toLowerCase()
  if (!n) return false
  if (n === "ivr menu" || n === "ivr") return true
  if (/\bivr\b/.test(n)) return true
  if (n.includes("smart overflow")) return true
  if (n.includes("keypad")) return true
  return false
}

/**
 * True only when a human (owner / receptionist) likely bridged live.
 * Carrier "answered" on an IVR Gather alone is NOT a human answer.
 */
function ownerLiveAnswered(input: MissedCallRecordInput): boolean {
  if (isAutomatedCallHandler(input.routed_to_name)) return false

  const answeredAt = input.answered_at ? Date.parse(input.answered_at) : NaN
  const endedAt = input.ended_at ? Date.parse(input.ended_at) : NaN
  if (Number.isFinite(answeredAt) && Number.isFinite(endedAt) && endedAt - answeredAt >= 2000) {
    return true
  }
  // Inbound rows preset routed_to_name ("Owner", "AI Receptionist") before anyone picks up — ignore it here.
  return false
}

/**
 * True when nobody answered the business line live (includes voicemail after no-answer,
 * IVR Gather-only legs, and AI receptionist without a human bridge).
 * Matches the routing strip SQL in getDailyCallTelemetryForOwner.
 */
export function isMissedCallRecord(input: MissedCallRecordInput): boolean {
  const type = normalizeCallType(input.call_type)
  const status = normalizeCallStatus(input.status)

  if (type === "missed" || type === "voicemail") return true
  if (["no-answer", "busy", "missed", "canceled", "cancelled"].includes(status)) return true

  // Automated handler — always an unhandled / machine-handled lead for callback metrics.
  if (isAutomatedCallHandler(input.routed_to_name)) return true

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

/** Missed inbound/voicemail on the owner’s local calendar day (resets at local midnight). */
export function isMissedCallTodayRecord(
  input: MissedCallRecordInput & { created_at?: string | null },
  now: Date = new Date()
): boolean {
  if (!input.created_at || !isLocalCalendarToday(input.created_at, now)) return false
  return isMissedCallRecord(input)
}
