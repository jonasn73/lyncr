// Intake sheet header / badge phase — human answer vs ringing / missed / voicemail.

import {
  isAnsweredFromQueueStatus,
  isHoldAutomationStatus,
} from "@/lib/inbound-time-capture"
import {
  isAutomatedCallHandler,
  isMissedCallRecord,
  ownerLiveAnswered,
  type MissedCallRecordInput,
} from "@/lib/missed-call-telemetry"

/** Live-leg chrome next to Decline / SMS — mirrors intake header phase. */
export type IntakeCallLinePhase = "ringing" | "answered" | "missed" | "voicemail" | "ended"

export type IntakeCallLinePhaseInput = MissedCallRecordInput & {
  /** Manual toolbar status when the sheet was opened without a Telnyx row. */
  manualCallStatus?: string | null
}

function normalizeType(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
}

function normalizeStatus(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
}

function isTerminalStatus(status: string): boolean {
  return ["completed", "busy", "failed", "no-answer", "canceled", "cancelled"].includes(status)
}

/** Map call log + intake row fields → header/badge phase. */
export function resolveIntakeCallLinePhase(input: IntakeCallLinePhaseInput): IntakeCallLinePhase {
  const type = normalizeType(input.call_type)
  const status = normalizeStatus(input.status)
  const manual = normalizeType(input.manualCallStatus)
  const routed = String(input.routed_to_name ?? "")

  // Lyncr Record / explicit voicemail tag wins even mid-greeting (before hangup).
  if (type === "voicemail" || /\bvoicemail\b/i.test(routed)) {
    return "voicemail"
  }

  const ended =
    manual === "completed" || Boolean(input.ended_at?.trim()) || isTerminalStatus(status)

  // Soft-hold / Busy menu — still waiting (or press-1 left). Check BEFORE automated
  // (Hold Queue is also tagged as capture/automation for Activity metrics).
  if (isHoldAutomationStatus(input.routed_to_name) && !isAnsweredFromQueueStatus(input.routed_to_name)) {
    return ended ? "ended" : "ringing"
  }

  // AI / IVR / capture paths are not human-answered.
  if (isAutomatedCallHandler(input.routed_to_name)) {
    return ended ? "missed" : "missed"
  }

  if (ended) {
    if (isMissedCallRecord(input)) {
      return type === "voicemail" ? "voicemail" : "missed"
    }
    return "ended"
  }

  if (manual === "ringing" || (manual !== "answered" && manual !== "on_hold" && !input.answered_at?.trim())) {
    return "ringing"
  }

  // Optimistic mid-call answer — only while telemetry still looks like a live human bridge.
  if (input.answered_at?.trim() && ownerLiveAnswered({ ...input, status: status || "in-progress" })) {
    return "answered"
  }
  if (input.answered_at?.trim() && !isMissedCallRecord({ ...input, status: status || "in-progress" })) {
    return "answered"
  }

  if (manual === "answered" || manual === "on_hold") {
    return "answered"
  }

  return "ringing"
}

/** Uppercase eyebrow above the caller number. */
export function intakeCallHeaderLabel(phase: IntakeCallLinePhase): string {
  switch (phase) {
    case "ringing":
      return "Incoming call"
    case "answered":
      return "Call answered"
    case "missed":
      return "Missed call"
    case "voicemail":
      return "Voicemail"
    case "ended":
      return "Call ended"
  }
}

/** Compact badge next to Decline / SMS. */
export function intakeCallBadgeLabel(phase: IntakeCallLinePhase): string {
  switch (phase) {
    case "ringing":
      return "Ringing"
    case "answered":
      return "Answered"
    case "missed":
      return "Missed"
    case "voicemail":
      return "Voicemail"
    case "ended":
      return "Ended"
  }
}

/** Tailwind classes for the compact status badge. */
export function intakeCallBadgeClassName(phase: IntakeCallLinePhase): string {
  switch (phase) {
    case "ringing":
      return "text-warning/90"
    case "answered":
      return "text-success/90"
    case "missed":
      return "text-destructive/90"
    case "voicemail":
      return "text-operator/90"
    case "ended":
      return "text-muted-foreground"
  }
}
