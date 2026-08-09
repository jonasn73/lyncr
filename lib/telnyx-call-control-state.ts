// client_state blob passed through Telnyx Call Control commands (base64 JSON).

export type TelnyxCallControlPhase =
  | "await_caller_answered"
  | "await_greeting_end"
  | "await_dial_end"
  | "await_voicemail_prompt_end"
  /** Busy / no-answer menu — gather_using_speak (press 1 = SMS, press 2 = owner). */
  | "await_busy_gather_end"
  /** After booking SMS — speak confirmation then hang up. */
  | "await_busy_sms_confirm_end"
  /**
   * Soft hold / Telnyx queue — music gather (or speak re-prompt).
   * Timeout → re-prompt; press 1 → SMS + leave; max wait → SMS once.
   */
  | "await_busy_hold_loop"
  /** Agent cell dialed from Lines Answer — bridge to queue when they pick up. */
  | "await_queue_agent_answer"
  | "recording"

/** Why Call Control chose this PSTN target (Busy backup vs owner day dial). */
export type TelnyxCallControlDialReason =
  | "day_dial"
  | "busy_backup_recv"
  | "team_receptionist"
  | "team_owner_available"
  | "busy_automation"
  | "custom_routing"
  | "legacy_recv"
  | "legacy_owner"
  | "failsafe"
  /** Owner/agent answering a waiting hold-queue caller from Lines. */
  | "queue_answer"

export type TelnyxCallControlClientState = {
  v: 1
  phase: TelnyxCallControlPhase
  userId: string
  businessLineE164: string
  callerE164: string
  /** Inbound caller leg — used to play voicemail after an outbound dial times out. */
  inboundCallControlId?: string
  /** Outbound PSTN (cell) dial leg — hang this up when the caller disconnects. */
  outboundCallControlId?: string
  dialTargetE164?: string
  ringTimeoutSec?: number
  fallbackType?: "voicemail" | "ai" | "owner"
  /** Presence / Who Answers reason for this Dial (Busy → teammate must not fall back to owner). */
  dialReason?: TelnyxCallControlDialReason
  /** Private receptionist being dialed (Busy backup or team mode). */
  receptionistId?: string
  /** Telnyx queue name (lyncr-{userId}) while on hold. */
  holdQueueName?: string
  /** Unix ms when this caller entered the hold loop (max-wait clock). */
  holdStartedAtMs?: number
  /** How many soft-hold re-prompts have played (position / ETA polish). */
  holdPromptCount?: number
  /** What the current gather is playing — drives the next timeout action. */
  holdSegment?: "music" | "reprompt"
  /** Waiting caller call_control_id when this leg is an Answer-from-Lines agent dial. */
  queueTargetCallControlId?: string
  /** Neon call_queue.id for the Answer target (optional). */
  queueEntryId?: string
}

export function encodeTelnyxCallControlState(state: TelnyxCallControlClientState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64")
}

export function decodeTelnyxCallControlState(raw: string | null | undefined): TelnyxCallControlClientState | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  try {
    const json = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8")) as TelnyxCallControlClientState
    if (json?.v !== 1 || !json.phase || !json.userId) return null
    return json
  } catch {
    return null
  }
}
