// client_state blob passed through Telnyx Call Control commands (base64 JSON).

type TelnyxCallControlPhase =
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
   * Timeout → re-prompt; press 1 → SMS + leave; max wait → SMS once (or AI bridge, see below).
   */
  | "await_busy_hold_loop"
  /**
   * Max hold wait reached on a Professional/Business account with an AI Assistant configured —
   * bridged into a live Telnyx AI Assistant conversation instead of the SMS-and-hangup default (`087`).
   * Ends on `call.conversation.ended` (booking-link SMS safety net + hangup).
   */
  | "await_ai_assistant_hold"
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
  fallbackType?: "voicemail" | "ai" | "owner" | "hold"
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
  /** Account override for max hold wait (seconds) — snapshotted at enqueue. */
  holdMaxWaitSecs?: number
  /** Account override for music segment length (seconds) — snapshotted at enqueue. */
  holdRepromptSecs?: number
  /**
   * Call Control Speak voice used for the Busy gather (NaturalHD / Polly neural).
   * Hold rempromts reuse this so reminders match the Busy greeting persona.
   */
  holdSpeakVoice?: string
  /**
   * True after we already retried Busy gather with NaturalHD because ElevenLabs speak failed.
   * Prevents an infinite invalid→retry loop.
   */
  busySpeakFallbackTried?: boolean
  /** Waiting caller call_control_id when this leg is an Answer-from-Lines agent dial. */
  queueTargetCallControlId?: string
  /** Neon call_queue.id for the Answer target (optional). */
  queueEntryId?: string
  /**
   * True when Dial used AMD + bridge_on_answer:false so we only bridge humans
   * (avoids personal cell carrier voicemail when fallback is hold / AI / company VM).
   */
  amdGuard?: boolean
  /** Unix ms when we POSTed the outbound Dial — used for AMD early-false-positive guards + logs. */
  dialStartedAtMs?: number
  /**
   * True when this caller had a missed/dropped attempt earlier today — computed once at
   * Busy entry so the greeting + hold reprompts can acknowledge a repeat caller without
   * re-querying call history on every reprompt cycle.
   */
  isRepeatCaller?: boolean
  /**
   * Saved customers.display_name for this caller phone, when found and TTS-safe
   * (see sanitizeCallerNameForSpeech) — computed once at Busy entry, carried like
   * isRepeatCaller so the SMS confirmation can reuse it without re-querying.
   */
  callerDisplayName?: string
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
