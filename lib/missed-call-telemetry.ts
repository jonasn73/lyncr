// Shared rules for "missed call" — routing HUD, Pusher deltas, and call-history dialog.

import { isLocalCalendarToday } from "@/lib/daily-call-telemetry"

export type MissedCallRecordInput = {
  call_type?: string | null
  status?: string | null
  /** Set when owner/receptionist bridged live on the call. */
  routed_to_name?: string | null
  /** Set when the callee leg answered (Your Phone / receptionist) — any duration counts. */
  answered_at?: string | null
  ended_at?: string | null
  /** Optional talk seconds — positive duration with a human answer reinforces live answer. */
  duration_seconds?: number | null
}

/** Canonical label written to call_logs.routed_to_name for Smart IVR Menu. */
export const IVR_MENU_ROUTED_TO_NAME = "IVR Menu"

/** Canonical label when Your Phone (owner cell) accepts the inbound leg. */
export const OWNER_PHONE_ROUTED_TO_NAME = "Owner"

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
 * True when Your Phone / a receptionist accepted the inbound leg.
 * Any answered_at counts — short 6s pickups must stay Answered, never Missed.
 * Carrier "answered" on an IVR Gather alone is excluded via automated handler check.
 */
export function ownerLiveAnswered(input: MissedCallRecordInput): boolean {
  if (isAutomatedCallHandler(input.routed_to_name)) return false

  if (input.answered_at?.trim()) {
    const answeredAt = Date.parse(input.answered_at)
    if (Number.isFinite(answeredAt)) return true
  }

  // Fallback: completed leg with talk time and a human routing label (Owner / named agent).
  const status = normalizeCallStatus(input.status)
  const duration = Number(input.duration_seconds ?? 0)
  const routed = String(input.routed_to_name ?? "").trim()
  if (
    status === "completed" &&
    duration > 0 &&
    routed &&
    !isAutomatedCallHandler(routed)
  ) {
    return true
  }

  return false
}

/**
 * True when nobody answered the business line live (includes voicemail after no-answer,
 * IVR Gather-only legs, and AI receptionist without a human bridge).
 * Matches the routing strip SQL in getDailyCallTelemetryForOwner.
 */
export function isMissedCallRecord(input: MissedCallRecordInput): boolean {
  // Human answer wins over a stale call_type=missed or short duration.
  if (ownerLiveAnswered(input)) return false

  const type = normalizeCallType(input.call_type)
  const status = normalizeCallStatus(input.status)

  if (type === "voicemail") return true
  if (type === "missed") return true
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
