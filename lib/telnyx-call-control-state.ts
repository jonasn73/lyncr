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
  /** "Say the make and model" ask is being spoken — speak.ended starts the recording. */
  | "await_hold_vehicle_voice_prompt"
  /**
   * A short hold-queue ack ("Perfect — thank you…") is being spoken — speak.ended
   * resumes hold music. Music must NOT start in the same turn as the speak: its
   * playback_start uses stop:"all", which cancels the in-flight TTS and the caller
   * hears no acknowledgement at all.
   */
  | "await_hold_ack_speak"
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
  /** After-hours on-call field tech (166) — dialed during CLOSED presence. */
  | "oncall_tech"

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
  /** After-hours on-call field tech being dialed (166, dialReason === "oncall_tech"). */
  technicianId?: string
  /** Tech's display name, stashed at dial time — resolveRoutedToLabel has no other way to get it. */
  technicianName?: string
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
  /** Caller requested and was sent a booking link; hold must not ask for intake again. */
  holdBookingLinkSent?: boolean
  /** Press 1 was selected; continue into hold after the confirmation speech. */
  holdBookingLinkRequested?: boolean
  /** Form completion has already been acknowledged aloud on this live call. */
  holdBookingFormAcknowledged?: boolean
  /** True once the owner has gotten the one-time "still waiting" heads-up text for this call. */
  holdLongWaitAlerted?: boolean
  /**
   * Call Control Speak voice used for the Busy gather (NaturalHD / Polly neural).
   * Hold rempromts reuse this so reminders match the Busy greeting persona.
   */
  holdSpeakVoice?: string
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
   * True once the caller has actually heard the initial branded greeting ("Thanks for
   * calling X, connecting you now") — set when its Speak succeeds, cleared if it fails.
   * Busy/Hold automation reads this to decide whether its own greeting needs to (re-)say
   * the business name, so the caller hears it exactly once rather than twice or never.
   */
  brandedGreetingPlayed?: boolean
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
  /**
   * True when a customers row exists for this caller phone (any booking type — the same
   * lookup that resolves callerDisplayName, just capturing existence too) — computed once
   * at Busy entry. Lets the hold loop skip re-asking intake questions to someone we
   * already have real details on file for, not just someone who answered them earlier
   * on a recent call.
   */
  isKnownCustomer?: boolean
  /**
   * Spoken vehicle descriptor ("2016 Chrysler 200") when a real customer_vehicles row
   * exists for this caller — computed once at Busy entry (see describeVehicleForSpeech),
   * carried like isKnownCustomer. Drives the vehicle-confirm question on the first hold
   * reprompt cycle; never implies recognition was spoken, only that we CAN ask about a
   * specific vehicle instead of a generic one.
   */
  holdVehicleOnFile?: string
  /** True once the vehicle-confirm question (holdVehicleOnFile) has been asked — asked only once. */
  holdVehicleConfirmOffered?: boolean
  /** True only while a gather is waiting on the vehicle-confirm answer (press 1 = yes, 2 = no). */
  holdAwaitingVehicleConfirm?: boolean
  /** True only while a gather is waiting on the "has anything changed" follow-up answer. */
  holdAwaitingVehicleChangedAnswer?: boolean
  /** Unix ms when ai_assistant_start was issued — used to bill AI-conversation minutes accurately (`087`). */
  aiAssistantStartedAtMs?: number
  /**
   * True once the Phase-1 hold-queue intake question has gotten a real answer (a
   * matched digit) — or the account's industry has no prompt configured at all. Either
   * way, once true, the question is never asked again. Unanswered/unmatched attempts
   * leave this false so a later reprompt cycle retries (see holdIntakeAttempts).
   */
  holdIntakeAnswered?: boolean
  /** How many times the Phase-1 question has been spoken — capped (see MAX_INTAKE_ATTEMPTS). */
  holdIntakeAttempts?: number
  /**
   * True only while a gather is specifically waiting on the intake question's answer —
   * disambiguates its digits (1/2/3 = which option) from the plain reprompt's single
   * "press 1" (= leave queue via SMS) on the very next gather.ended.
   */
  holdAwaitingIntakeAnswer?: boolean
  /**
   * Phase-2 numeric follow-up queued by the option picked in Phase 1 (e.g. "type the
   * service ZIP") — carried on state until it's answered or gives up retrying.
   */
  holdIntakeFollowUp?: { text: string; maxDigits: number; fieldKey: string; fieldLabel: string }
  holdVehicleVoiceRequired?: boolean
  /**
   * True once the Phase-2 follow-up captured a FULL answer (all maxDigits digits) — a
   * partial or empty answer leaves this false so a later cycle retries instead of
   * treating a partial ZIP as final.
   */
  holdIntakeFollowUpAnswered?: boolean
  /** How many times the Phase-2 follow-up has been spoken — capped (see MAX_INTAKE_ATTEMPTS). */
  holdIntakeFollowUpAttempts?: number
  /** True only while a gather is waiting on the Phase-2 follow-up's numeric answer. */
  holdAwaitingIntakeFollowUpAnswer?: boolean
  /**
   * True only while the spoken make/model clip is recording (Phase 3) — the very next
   * gather.ended (backstop timeout, pound, or any digit) stops the recording and
   * resumes hold music instead of being read as a press-1 / reprompt digit.
   */
  holdAwaitingVehicleVoice?: boolean
  /** True once the spoken make/model ask has run at least once (first-ask guard). */
  holdVehicleVoiceDone?: boolean
  /** How many times the spoken make/model ask has run — retries are capped. */
  holdVehicleVoiceAttempts?: number
  /** Unix ms when the last clip finished recording — stale transcription → retry. */
  holdVehicleVoiceRecordedAtMs?: number
  /** True only while a gather is waiting on the make/model read-back confirm (1 = right, 2 = redo). */
  holdAwaitingVehicleVoiceConfirm?: boolean
  /** How many times the read-back confirm has been asked for the current capture. */
  holdVehicleVoiceConfirmAsks?: number
  /** True once the caller confirmed the captured make/model — step fully complete. */
  holdVehicleVoiceConfirmed?: boolean
  /**
   * Human-readable summary of what's been captured so far (e.g. "Lost key / needs new
   * key made — Year 2009") — built up as each phase answers, used for the reprompt copy
   * once fully answered and for the owner "caller answered" SMS.
   */
  holdIntakeSummary?: string
  /** True when the matched Phase-1 option is a "right now" situation — see isUrgentHoldQueueIntentSlug. */
  holdIntakeUrgent?: boolean
  /** One-time persisted lead and owner SMS once this call's intake is complete. */
  holdIntakeCapturedAlerted?: boolean
  /**
   * True only while a gather is waiting on the callback-number confirm ("press 1, that's
   * right" / "press 2, use a different number") triggered by pressing 2 during hold.
   */
  holdAwaitingCallbackConfirm?: boolean
  /** True only while a gather is waiting on a caller-typed replacement callback number. */
  holdAwaitingCallbackNumber?: boolean
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
