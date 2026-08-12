// When owner cell misses → Busy/hold, dismiss the full RINGING / New Intake sheet.
// Lines waiting card + compact toast are the UI until a real Answer bridges.

import {
  isAnsweredFromQueueStatus,
  isHoldAutomationStatus,
} from "@/lib/inbound-time-capture"
import { normalizeCallEventPhoneDigits } from "@/lib/realtime/owner-call-event-types"
import {
  shouldOpenOwnerAnsweredIntake,
  shouldOpenOwnerRingingIntake,
} from "@/lib/realtime/owner-call-event-types"

/** Minimal open-sheet fields used to match a Pusher / poll leg. */
export type RingingIntakeMatchRow = {
  id: string
  from_number?: string | null
  sourceCallLogId?: string | null
  manualCallStatus?: string | null
  answered_at?: string | null
  ended_at?: string | null
  routed_to_name?: string | null
}

function phoneDigitsKey(raw: string | null | undefined): string {
  const digits = normalizeCallEventPhoneDigits(raw)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

/** True when the sheet is still in pre-answer RINGING chrome (not a live human bridge). */
export function isRingingOnlyIntakeRow(row: RingingIntakeMatchRow | null | undefined): boolean {
  if (!row) return false
  if (row.ended_at?.trim()) return false
  if (row.manualCallStatus === "completed") return false
  // Hold waiters sometimes stamp a false answered_at / answered chrome — still not a live bridge.
  if (isHoldAutomationStatus(row.routed_to_name) && !isAnsweredFromQueueStatus(row.routed_to_name)) {
    return true
  }
  if (row.manualCallStatus === "answered" || row.manualCallStatus === "on_hold") return false
  if (row.manualCallStatus === "ringing") return true
  return !row.answered_at?.trim()
}

/** Match open intake to a hold / hangup / poll payload (call log id, ring-* alias, or phone). */
export function openIntakeMatchesCallLeg(
  open: RingingIntakeMatchRow,
  payload: {
    call_log_id?: string | null
    call_sid?: string | null
    from_number?: string | null
  }
): boolean {
  const callLogId = String(payload.call_log_id ?? "").trim()
  const callSid = String(payload.call_sid ?? "").trim()
  if (callLogId && (open.id === callLogId || open.sourceCallLogId === callLogId)) return true
  if (callSid && open.id === `ring-${callSid}`) return true
  const fromDigits = phoneDigitsKey(payload.from_number)
  if (fromDigits && phoneDigitsKey(open.from_number) === fromDigits) return true
  return false
}

/**
 * True when Busy → hold / press-1 automation should close an open RINGING sheet
 * (same class as shouldOpenOwner* suppress — never leave RINGING forever).
 */
export function shouldDismissOpenRingingIntakeForAutomation(payload: {
  routed_to_receptionist_id?: string | null
  routed_to_name?: string | null
  dial_reason?: string | null
}): boolean {
  // Teammate Dial never opened owner RINGING for this leg — nothing to dismiss from hold tags.
  if (String(payload.routed_to_receptionist_id ?? "").trim()) {
    return !shouldOpenOwnerRingingIntake(payload)
  }
  if (!shouldOpenOwnerAnsweredIntake(payload)) return true
  if (!shouldOpenOwnerRingingIntake(payload)) return true
  return false
}

/**
 * Hangup / press-1 left: auto-close only when the sheet never became a real human Answer.
 * Keeps post-call booking open after a live owner/queue bridge.
 */
export function shouldAutoDismissIntakeOnCallCompleted(
  open: RingingIntakeMatchRow,
  payload: {
    routed_to_name?: string | null
    answered_at?: string | null
    call_type?: string | null
  }
): boolean {
  if (isRingingOnlyIntakeRow(open)) return true
  if (isHoldAutomationStatus(payload.routed_to_name) && !isAnsweredFromQueueStatus(payload.routed_to_name)) {
    return true
  }
  if (isHoldAutomationStatus(open.routed_to_name) && !isAnsweredFromQueueStatus(open.routed_to_name)) {
    return true
  }
  return false
}

/**
 * Poll backup: open RINGING row left ringing-recent — dismiss ONLY with positive proof
 * (hold/Busy menu, terminal status, or ended_at). A transient empty ringing-recent poll
 * must NOT close Incoming Call while the owner cell is still dialing.
 */
export function shouldDismissRingingIntakeAfterPollMiss(params: {
  open: RingingIntakeMatchRow
  /** Still listed in /api/calls/ringing-recent. */
  stillRinging: boolean
  /** Same leg found in answered-recent with shouldOpenOwnerAnsweredIntake. */
  upgradingToAnswered: boolean
  /** Latest routed_to_name / status from a lightweight call lookup (optional). */
  routedToName?: string | null
  status?: string | null
  endedAt?: string | null
  /**
   * When false, ringing-recent fetch failed / was non-OK — never dismiss on that alone
   * (network blip would close intake while the cell is still ringing).
   */
  ringingLookupOk?: boolean
}): boolean {
  // Live Answer / booking chrome — poll must not tear the sheet down.
  if (!isRingingOnlyIntakeRow(params.open)) return false
  // Still on the owner-ring list — keep Incoming Call open for the full dial window.
  if (params.stillRinging) return false
  // Bridged row is about to replace RINGING — keep open so the sheet can upgrade.
  if (params.upgradingToAnswered) return false
  // Failed / unknown ringing poll — do not treat as “left the ring path”.
  if (params.ringingLookupOk === false) return false
  // Caller hung up / row finalized — safe to close RINGING.
  if (params.endedAt?.trim()) return true
  const status = String(params.status ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
  // Terminal dial outcomes after the cell stop ringing.
  if (["completed", "busy", "failed", "no-answer", "canceled", "cancelled"].includes(status)) {
    return true
  }
  // Busy menu / Hold queue owns the caller after the configured ring timeout.
  const routed = params.routedToName ?? params.open.routed_to_name
  if (isHoldAutomationStatus(routed)) {
    return !isAnsweredFromQueueStatus(routed)
  }
  // Still dialing (status ringing / in-progress / unknown) or summary missing —
  // keep intake open; Pusher hold/hangup or a later confirmed poll will close it.
  return false
}
