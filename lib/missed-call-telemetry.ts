// Shared rules for "missed call" — routing HUD, Pusher deltas, and call-history dialog.

import { isLocalCalendarToday } from "@/lib/daily-call-telemetry"
import {
  isCaptureEmergencyAnswered,
  isCaptureMissedLinkStatus,
} from "@/lib/inbound-time-capture"

export {
  CAPTURE_STATUS_DAY_LINK,
  CAPTURE_STATUS_EMERGENCY_ANSWERED,
  CAPTURE_STATUS_NIGHT_LINK,
} from "@/lib/inbound-time-capture"

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

/**
 * Talk seconds below this count as missed even if the carrier said "completed"
 * (voicemail / aborted connect / false answer). Press-1 confirmations normally
 * produce longer bridged talk; sub-5s legs are almost never real conversations.
 */
export const MIN_LIVE_ANSWER_DURATION_SECONDS = 5

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
 * True when the call was handled by IVR / AI / voicemail / capture SMS — not a live team member.
 * These must never count as green live "Answered" in Activities or missed metrics.
 */
export function isAutomatedCallHandler(routedToName: string | null | undefined): boolean {
  if (isCaptureMissedLinkStatus(routedToName)) return true
  // Emergency Answered is a live human bridge — not automated.
  if (isCaptureEmergencyAnswered(routedToName)) return false

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
  if (n.includes("night capture") || n.includes("day capture")) return true
  if (n.includes("calendar day off") || n.includes("calendar busy")) return true
  if (n.includes("presence closed") || n.includes("presence on-job") || n.includes("presence on job")) {
    return true
  }
  if (n.includes("sent night link") || n.includes("sent day link")) return true
  if (n.includes("sent day off link") || n.includes("sent busy link")) return true
  if (n.includes("sent closed link") || n.includes("sent on-job link") || n.includes("sent on job link")) {
    return true
  }
  return false
}

/** IVR / keypad / night-day capture path (for Missed (IVR) badge + chronology copy). */
export function isIvrMenuHandler(routedToName: string | null | undefined): boolean {
  if (isCaptureMissedLinkStatus(routedToName)) return true
  const n = String(routedToName ?? "")
    .trim()
    .toLowerCase()
  if (!n) return false
  if (n === "ivr menu" || n === "ivr") return true
  if (/\bivr\b/.test(n)) return true
  if (n.includes("smart overflow")) return true
  if (n.includes("keypad")) return true
  if (n.includes("night capture") || n.includes("day capture")) return true
  if (n.includes("calendar day off") || n.includes("calendar busy")) return true
  if (n.includes("presence closed") || n.includes("presence on-job") || n.includes("presence on job")) {
    return true
  }
  if (n.includes("sent night link") || n.includes("sent day link")) return true
  if (n.includes("sent day off link") || n.includes("sent busy link")) return true
  if (n.includes("sent closed link") || n.includes("sent on-job link") || n.includes("sent on job link")) {
    return true
  }
  return false
}

/**
 * True when Your Phone / a receptionist accepted the inbound leg for real.
 * Short talk time (&lt; {@link MIN_LIVE_ANSWER_DURATION_SECONDS}) is treated as missed
 * even with answered_at — cell voicemail often "answers" without a human.
 */
export function ownerLiveAnswered(input: MissedCallRecordInput): boolean {
  // Night emergency press-2 that connected.
  if (isCaptureEmergencyAnswered(input.routed_to_name)) {
    if (input.answered_at?.trim()) {
      const duration = Number(input.duration_seconds ?? NaN)
      if (Number.isFinite(duration) && duration < MIN_LIVE_ANSWER_DURATION_SECONDS) return false
      return true
    }
    const status = normalizeCallStatus(input.status)
    const duration = Number(input.duration_seconds ?? 0)
    if (status === "completed" && duration >= MIN_LIVE_ANSWER_DURATION_SECONDS) return true
  }

  if (isAutomatedCallHandler(input.routed_to_name)) return false

  const duration = Number(input.duration_seconds ?? NaN)
  const shortTalk =
    Number.isFinite(duration) && duration >= 0 && duration < MIN_LIVE_ANSWER_DURATION_SECONDS

  if (input.answered_at?.trim()) {
    const answeredAt = Date.parse(input.answered_at)
    if (!Number.isFinite(answeredAt)) return false
    // Known sub-threshold talk time → voicemail / abandoned connect.
    if (shortTalk) return false
    return true
  }

  // Fallback: completed leg with real talk time and a human routing label (Owner / named agent).
  const status = normalizeCallStatus(input.status)
  const routed = String(input.routed_to_name ?? "").trim()
  if (
    status === "completed" &&
    Number.isFinite(duration) &&
    duration >= MIN_LIVE_ANSWER_DURATION_SECONDS &&
    routed &&
    !isAutomatedCallHandler(routed)
  ) {
    return true
  }

  return false
}

/**
 * True when nobody answered the business line live (includes voicemail after no-answer,
 * IVR Gather-only legs, AI receptionist without a human bridge, and sub-5s "completed" legs).
 * Matches the routing strip SQL in getDailyCallTelemetryForOwner.
 */
export function isMissedCallRecord(input: MissedCallRecordInput): boolean {
  // Human answer wins over a stale call_type=missed — unless talk time is too short.
  if (ownerLiveAnswered(input)) return false

  const type = normalizeCallType(input.call_type)
  const status = normalizeCallStatus(input.status)
  const duration = Number(input.duration_seconds ?? NaN)

  if (type === "voicemail") return true
  if (type === "missed") return true
  if (["no-answer", "busy", "missed", "canceled", "cancelled"].includes(status)) return true

  // Explicit short talk-time rule (even when carrier said completed + stamped answered_at).
  if (
    Number.isFinite(duration) &&
    duration >= 0 &&
    duration < MIN_LIVE_ANSWER_DURATION_SECONDS &&
    type !== "outgoing"
  ) {
    return true
  }

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

/** Prefer exact capture status strings in Activities / Missed Call Rescue UI. */
export function formatCaptureRoutedStatus(routedToName: string | null | undefined): string | null {
  const n = String(routedToName ?? "").trim()
  if (!n) return null
  if (n === "Missed - Sent Night Link") return n
  if (n === "Missed - Sent Day Link") return n
  if (n === "Missed - Sent Day Off Link") return n
  if (n === "Missed - Sent Busy Link") return n
  if (n === "Missed - Sent Closed Link") return n
  if (n === "Missed - Sent On-Job Link") return n
  if (n === "Emergency Answered") return n
  return null
}
