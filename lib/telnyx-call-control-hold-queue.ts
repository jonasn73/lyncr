// ============================================
// Call Control hold queue — soft hold + Telnyx enqueue + Answer bridge
// ============================================
// Phase A: stay-on-line → music/gather loop (not SMS+hangup).
// Phase B: enqueue lyncr-{userId} + Neon call_queue + Lines Answer.
// Phase C: position hint on re-prompt, Activity “Hold Queue”, custom music URL.
//
// Hold loop state machine (client_state.holdSegment):
//   music gather timeout → speak re-prompt gather
//   re-prompt gather timeout → music gather again
//   press 1 anytime → SMS + leave_queue + confirm
//   max wait → one SMS + hangup

import { after } from "next/server"
import {
  countWaitingCallQueue,
  getAccountHoldSettings,
  getCallQueueCollectedByCallControlId,
  getCallQueuePosition,
  getCallQueueStatusByCallControlId,
  mergeCallQueueCollected,
  updateCallQueueStatus,
  upsertCallQueueWaiting,
} from "@/lib/call-queue-db"
import { getAccountPresence } from "@/lib/account-presence"
import {
  HOLD_FIRST_REPROMPT_MS,
  HOLD_REPROMPT_ALREADY_ANSWERED,
  HOLD_REPROMPT_DEFAULT,
  HOLD_REPROMPT_KNOWN_CUSTOMER,
  HOLD_VEHICLE_CHANGED_PROMPT,
  HOLD_VEHICLE_NO_CHANGE_REPROMPT,
  holdLongWaitAlertMs,
  holdMaxConcurrent,
  holdMaxWaitSecs,
  holdMusicMediaName,
  holdRePromptIntervalMs,
  holdVehicleConfirmPrompt,
  lyncrHoldQueueName,
  resolveHoldMusicUrlCandidates,
} from "@/lib/hold-queue"
import { sendHoldLongWaitOwnerAlert } from "@/lib/hold-long-wait-alert"
import { loadHoldMusicPlaybackContentBase64 } from "@/lib/hold-inline-audio"
import {
  CAPTURE_STATUS_HOLD_AI_ASSISTED,
  CAPTURE_STATUS_HOLD_CAP_SMS,
  CAPTURE_STATUS_HOLD_PRESS1,
  CAPTURE_STATUS_HOLD_QUEUE,
  CAPTURE_STATUS_HOLD_TIMEOUT_SMS,
} from "@/lib/inbound-time-capture"
import { bookingIntakePrefillFromCollected } from "@/lib/book-customer-request"
import { bookingSmsConfirmSpeech, sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"
import type { HoldIntakeSmsContext } from "@/lib/telnyx-menu"
import { resolveSpeakVoiceForPersona } from "@/lib/ivr-automation-settings"
import { lyncrLog } from "@/lib/lyncr-env"
import { resolveAiVoiceAssistantEntitlement } from "@/lib/ai-voice-entitlement"
import {
  markTelnyxCallControlTerminal,
  telnyxCallControlBridge,
  telnyxCallControlGather,
  telnyxCallControlGatherStop,
  telnyxCallControlGatherUsingAudio,
  telnyxCallControlGatherUsingSpeak,
  telnyxCallControlHangup,
  telnyxCallControlLeaveQueue,
  telnyxCallControlPlaybackStart,
  telnyxCallControlPlaybackStop,
  telnyxCallControlRecordStart,
  telnyxCallControlRecordStop,
  telnyxCallControlSpeak,
  telnyxCallControlStartAiAssistant,
  telnyxCallControlStopAiAssistant,
} from "@/lib/telnyx-call-control-api"
import {
  encodeTelnyxCallControlState,
  type TelnyxCallControlClientState,
} from "@/lib/telnyx-call-control-state"
import { getUser, normalizePhoneNumberE164, updateCallLog } from "@/lib/db"
import { saveCallIntake } from "@/lib/intake-engine"
import {
  holdQueueIntakeValidDigits,
  isUrgentHoldQueueIntentSlug,
  resolveHoldQueueIntakeOption,
  resolveHoldQueueIntakePrompt,
  resolveHoldVehicleVoiceStep,
  VEHICLE_VOICE_PENDING_STALE_MS,
  type HoldQueueIntakeFollowUp,
  type HoldQueueIntakePrompt,
} from "@/lib/hold-queue-intake-prompts"

type RoutingLike = { user_id: string; owner_phone?: string | null }

/**
 * How many times each hold-queue intake question (Phase 1 and its Phase-2 follow-up)
 * gets spoken before giving up — one initial ask plus one retry a cycle later. Keeps the
 * "no repeat pressure" rule (never nag every cycle for the rest of the call) while still
 * giving a caller who missed it once a second chance.
 */
const MAX_INTAKE_ATTEMPTS = 2

/** Tag Activity as Hold Queue + tell the dashboard to close RINGING intake (best-effort). */
async function tagHoldQueueCallLog(callControlId: string): Promise<void> {
  try {
    await updateCallLog(callControlId, {
      routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
      status: "in-progress",
      // Waiting on soft-hold is NOT a human pickup — clear any false answered_at stamp
      // so answered-recent poll / CALL ANSWERED intake never opens while they wait.
      answered_at: null,
    })
    // Pusher: dismiss any open Incoming Call / New Intake still stuck on RINGING.
    const { getCallLogSnapshotForTelemetry } = await import("@/lib/db")
    const snapshot = await getCallLogSnapshotForTelemetry(callControlId).catch(() => null)
    if (snapshot?.id && snapshot.from_number) {
      const { broadcastCallHoldPathEntered } = await import("@/lib/call-telemetry-realtime")
      await broadcastCallHoldPathEntered({
        ownerUserId: snapshot.user_id,
        callSid: callControlId,
        callLogId: snapshot.id,
        fromNumber: snapshot.from_number,
        toNumber: snapshot.to_number,
        organizationId: snapshot.organization_id,
        routedToName: CAPTURE_STATUS_HOLD_QUEUE,
      })
    }
  } catch (e) {
    console.warn(lyncrLog("hold-queue-tag-log-failed", { error: String(e) }))
  }
}

function holdElapsedMs(state: TelnyxCallControlClientState): number {
  const started = Number(state.holdStartedAtMs || 0)
  if (!started) return 0
  return Math.max(0, Date.now() - started)
}

function holdTimedOut(state: TelnyxCallControlClientState): boolean {
  return holdElapsedMs(state) >= holdMaxWaitSecs(state.holdMaxWaitSecs) * 1000
}

/** True once Phase 1 (and Phase 2, if one was queued) both have a real, complete answer. */
function isHoldIntakeFullyAnswered(state: TelnyxCallControlClientState): boolean {
  return (
    Boolean(state.holdIntakeAnswered) &&
    (!state.holdIntakeFollowUp || Boolean(state.holdIntakeFollowUpAnswered))
  )
}

/**
 * What was captured on hold, shaped for the booking SMS + spoken confirmation. The raw
 * call_queue.collected answers ride along as the booking invite's /book pre-fill, so
 * the customer never re-types what they already answered over DTMF (and the SMS body
 * never dumps "We've got: …" at them — reported live by a customer).
 */
async function holdIntakeSmsContext(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<HoldIntakeSmsContext> {
  // A failed collected read must never block the SMS itself — fall back to summary-only.
  let collected: Record<string, unknown> | null = null
  try {
    collected = await getCallQueueCollectedByCallControlId(callControlId)
  } catch {
    collected = null
  }
  return {
    summary: state.holdIntakeSummary ?? null,
    prefill: bookingIntakePrefillFromCollected(collected),
  }
}

/** Saved persona voice, or the account's IVR voice, or the shared NaturalHD default. */
async function resolveHoldSpeakVoice(state: TelnyxCallControlClientState): Promise<string> {
  const saved = state.holdSpeakVoice?.trim()
  if (saved) return saved
  try {
    const presence = await getAccountPresence(state.userId)
    return resolveSpeakVoiceForPersona(presence.ivrVoiceEngineModel) || "Telnyx.NaturalHD.astra"
  } catch {
    return "Telnyx.NaturalHD.astra"
  }
}

/** Build short call-center reminder with optional “you're next” (Phase C). */
async function buildHoldRepromptText(
  state: TelnyxCallControlClientState,
  callControlId: string
): Promise<string> {
  let hint = ""
  try {
    const pos = await getCallQueuePosition(state.userId, callControlId)
    if (pos === 1) hint = " You're next."
    else if (pos != null && pos > 1) hint = ` You are number ${pos} in line.`
  } catch {
    /* position is polish only */
  }
  // Thank a caller only for answers given on this call. A path that has no
  // current-call summary gets a neutral reminder instead.
  const base = !isHoldIntakeFullyAnswered(state)
    ? HOLD_REPROMPT_DEFAULT
    : state.holdIntakeSummary
      ? HOLD_REPROMPT_ALREADY_ANSWERED
      : HOLD_REPROMPT_KNOWN_CUSTOMER
  return `${base}${hint}`
}

/**
 * After Busy gather timeout (stay on line) — music ASAP + Neon queue for Lines Answer.
 * Press 1 on the *first* Busy menu still SMS+hangups (handled by inbound before this).
 *
 * Soft-hold intentionally skips Telnyx `enqueue` so media is not parked/cleared —
 * Answer bridges by stored `call_control_id` (see /api/calls/queue/answer).
 *
 * Latency: fire `playback_start` (cached inline WAV) before any Neon awaits.
 */
export async function enterBusyHoldQueue(params: {
  callControlId: string
  state: TelnyxCallControlClientState
  routing: RoutingLike
  callSessionId?: string | null
  /** Date.now() when Busy gather.ended was received — for gather→music ms logs. */
  gatherEndedAtMs?: number
  /**
   * True when inbound already kicked `playback_start` (stay-on-line path).
   * We still attach gather + finish Neon work.
   */
  musicAlreadyStarted?: boolean
}): Promise<void> {
  const { callControlId, state, routing } = params
  const userId = routing.user_id || state.userId
  const gatherEndedAtMs = params.gatherEndedAtMs ?? Date.now()
  const queueName = lyncrHoldQueueName(userId)
  const holdStartedAtMs = state.holdStartedAtMs || Date.now()

  // Minimal hold state — defaults only. Do NOT await Neon before music.
  const nextState: TelnyxCallControlClientState = {
    ...state,
    userId,
    phase: "await_busy_hold_loop",
    dialReason: "busy_automation",
    holdQueueName: queueName,
    holdStartedAtMs,
    holdPromptCount: 0,
    holdSegment: "music",
    holdMaxWaitSecs: holdMaxWaitSecs(null),
    inboundCallControlId: state.inboundCallControlId || callControlId,
  }

  // 1) Music FIRST (or finish gather if inbound already started playback).
  // Skip Neon on this call — inline/bundled paths do not need account settings.
  let musicOk = params.musicAlreadyStarted
    ? await attachHoldMusicGatherOnly(callControlId, nextState, gatherEndedAtMs)
    : await startHoldMusicGather(callControlId, nextState, {
        gatherEndedAtMs,
        skipAccountFetch: true,
      })

  // 2) Cap + settings + Neon queue — AFTER music kicked (parallel).
  const [waiting, holdSettings] = await Promise.all([
    countWaitingCallQueue(userId).catch(() => 0),
    getAccountHoldSettings(userId).catch(() => ({
      holdMusicUrl: null as string | null,
      holdMaxWaitSecs: null as number | null,
      holdRepromptSecs: null as number | null,
    })),
  ])

  // If inline/bundled failed and account has a custom URL, retry once with it.
  if (!musicOk && !params.musicAlreadyStarted && holdSettings.holdMusicUrl) {
    musicOk = await startHoldMusicGather(callControlId, nextState, {
      gatherEndedAtMs,
      skipAccountFetch: true,
      holdMusicUrl: holdSettings.holdMusicUrl,
      holdRepromptSecs: holdSettings.holdRepromptSecs,
    })
  }

  if (waiting >= holdMaxConcurrent()) {
    console.log(
      lyncrLog("telnyx-cc-hold-cap-reached", {
        callControlId,
        userId,
        waiting,
        cap: holdMaxConcurrent(),
      })
    )
    await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
    const { outcome } = await sendInboundBookingSmsAndTag({
      fromE164: state.callerE164,
      ownerUserId: userId,
      businessLineE164: state.businessLineE164,
      callSid: callControlId,
      routedToName: CAPTURE_STATUS_HOLD_CAP_SMS,
      source: "cc_busy_hold_cap",
      tone: "hold_timeout",
      intake: await holdIntakeSmsContext(callControlId, state),
    })
    const confirmState = encodeTelnyxCallControlState({
      ...state,
      phase: "await_busy_sms_confirm_end",
      dialReason: "busy_automation",
    })
    await telnyxCallControlSpeak(
      callControlId,
      bookingSmsConfirmSpeech(outcome, "max_wait", {
        callerDisplayName: state.callerDisplayName,
        intakeSummary: state.holdIntakeSummary,
      }),
      confirmState
    )
    return
  }

  // Apply account hold tuning on client_state for the next remprompt cycle (music already playing).
  nextState.holdMaxWaitSecs = holdMaxWaitSecs(holdSettings.holdMaxWaitSecs)
  nextState.holdRepromptSecs = holdSettings.holdRepromptSecs ?? undefined

  // Lines Answer list + Activity tag — never block audio.
  void upsertCallQueueWaiting({
    userId,
    callControlId,
    callSessionId: params.callSessionId,
    callerE164: state.callerE164,
    businessLineE164: state.businessLineE164,
  }).catch((e) => console.warn(lyncrLog("hold-queue-upsert-failed", { error: String(e) })))
  void tagHoldQueueCallLog(callControlId)

  console.log(
    lyncrLog("telnyx-cc-hold-entered", {
      callControlId,
      userId,
      queueName,
      enqueued: false,
      softHoldNoTelnyxEnqueue: true,
      musicStarted: musicOk,
      gatherToEnteredMs: Date.now() - gatherEndedAtMs,
      accountMusicOverride: holdSettings.holdMusicUrl || null,
    })
  )
}

/**
 * Fire `playback_start` with cached inline WAV only — no gather, no DB.
 * Used by inbound stay-on-line to cut gather_ended → audible music gap.
 */
export async function kickHoldMusicPlaybackImmediate(params: {
  callControlId: string
  state: TelnyxCallControlClientState
  gatherEndedAtMs?: number
}): Promise<boolean> {
  const { callControlId, state } = params
  const gatherEndedAtMs = params.gatherEndedAtMs ?? Date.now()
  const inline = loadHoldMusicPlaybackContentBase64()
  if (!inline) {
    console.warn(lyncrLog("telnyx-cc-hold-kick-no-inline", { callControlId }))
    return false
  }
  const encoded = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "music",
    holdStartedAtMs: state.holdStartedAtMs || Date.now(),
  })
  const playRes = await telnyxCallControlPlaybackStart(callControlId, {
    playbackContent: inline,
    clientState: encoded,
    loop: "infinity",
    stop: "all",
  })
  const ms = Date.now() - gatherEndedAtMs
  if (!playRes.ok) {
    console.warn(
      lyncrLog("telnyx-cc-hold-kick-failed", {
        callControlId,
        error: playRes.error,
        gatherToMusicMs: ms,
      })
    )
    return false
  }
  console.log(
    lyncrLog("telnyx-cc-hold-music-started", {
      callControlId,
      mode: "playback_content_kick",
      usedPlaybackContent: true,
      gatherToMusicMs: ms,
    })
  )
  return true
}

/** Attach DTMF gather after an early playback kick (music already looping). */
async function attachHoldMusicGatherOnly(
  callControlId: string,
  state: TelnyxCallControlClientState,
  gatherEndedAtMs: number
): Promise<boolean> {
  // This function only ever runs once per call — enterBusyHoldQueue's musicAlreadyStarted
  // branch, the very first hold segment — so the first-cycle shortening always applies here.
  // (Confirmed missing on a real test call: this path, not startHoldMusicGather's own
  // first-entry branch, is the one that actually fires whenever inbound pre-kicks music
  // before routing resolves — the common case — so skipping this left the real first
  // reprompt at the full ~60s default instead of the intended 18s.)
  const repromptMs = Math.min(holdRePromptIntervalMs(state.holdRepromptSecs), HOLD_FIRST_REPROMPT_MS)
  const encoded = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "music",
  })
  const gatherRes = await telnyxCallControlGather(callControlId, {
    clientState: encoded,
    timeoutMillis: repromptMs,
    maximumDigits: 1,
    validDigits: "12",
  })
  console.log(
    lyncrLog("telnyx-cc-hold-gather-attached", {
      callControlId,
      ok: gatherRes.ok,
      gatherToGatherMs: Date.now() - gatherEndedAtMs,
      error: gatherRes.ok ? null : gatherRes.error,
    })
  )
  return gatherRes.ok || true
}

/**
 * call.enqueued webhook — no-op for music.
 * Soft-hold no longer uses Telnyx enqueue; if an old path still enqueues, do not
 * restart playback (that caused late/gappy music).
 */
export async function handleCallEnqueuedHoldMusic(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  if (state.phase !== "await_busy_hold_loop") return
  console.log(
    lyncrLog("telnyx-cc-hold-enqueued-skip-music-restart", {
      callControlId,
      holdSegment: state.holdSegment || null,
      note: "music_already_started_before_enqueue",
    })
  )
}

/** Play looping hold music + collect digit 1 (or speak-only when every music path fails). */
async function startHoldMusicGather(
  callControlId: string,
  state: TelnyxCallControlClientState,
  opts?: {
    gatherEndedAtMs?: number
    /** Skip Neon hold-settings fetch (use state / defaults — music first). */
    skipAccountFetch?: boolean
    /** Optional account override already loaded by caller. */
    holdMusicUrl?: string | null
    holdRepromptSecs?: number | null
  }
): Promise<boolean> {
  if (holdTimedOut(state)) {
    await finishHoldWithSms(callControlId, state, "timed_out")
    return false
  }

  const gatherEndedAtMs = opts?.gatherEndedAtMs ?? Date.now()

  // Defaults first — never block the first playback_start on Neon.
  let accountMusicUrl = opts?.holdMusicUrl ?? null
  let accountRepromptSecs = opts?.holdRepromptSecs ?? state.holdRepromptSecs ?? null
  let accountMaxWait = state.holdMaxWaitSecs ?? null

  const mediaName = holdMusicMediaName()
  // Resolve bundled/env URLs without DB (inline path tried before any of these).
  let musicCandidates = resolveHoldMusicUrlCandidates(accountMusicUrl)
  // Only enterBusyHoldQueue's very-first call passes this — every resume (after a
  // reprompt/intake speak) already goes through the Neon-settings branch below.
  const isFastFirstEntry = opts?.skipAccountFetch === true
  let repromptMs = holdRePromptIntervalMs(accountRepromptSecs)
  // First-ever segment: get to the Phase-1 industry question sooner instead of making
  // every caller sit through a full 45–90s of music before it's ever asked.
  if (isFastFirstEntry) repromptMs = Math.min(repromptMs, HOLD_FIRST_REPROMPT_MS)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "music",
    holdMaxWaitSecs: state.holdMaxWaitSecs ?? holdMaxWaitSecs(accountMaxWait),
    holdRepromptSecs: accountRepromptSecs ?? undefined,
  }
  let encoded = encodeTelnyxCallControlState(nextState)

  const logMusicStarted = (label: string, extra: Record<string, unknown> = {}) => {
    console.log(
      lyncrLog("telnyx-cc-hold-music-started", {
        callControlId,
        mode: label,
        gatherToMusicMs: Date.now() - gatherEndedAtMs,
        ...extra,
      })
    )
  }

  // Prefer inline base64 first (no Telnyx→lyncr.app fetch = music sooner),
  // then Media Storage name, then public HTTPS WAV URLs.
  const tryPlaybackThenGather = async (
    label: string,
    playOpts: {
      audioUrl?: string | null
      mediaName?: string | null
      playbackContent?: string | null
    }
  ): Promise<boolean> => {
    const playRes = await telnyxCallControlPlaybackStart(callControlId, {
      ...playOpts,
      clientState: encoded,
      loop: "infinity",
      // Clear any leftover Busy-speak / prior clip so music starts cleanly.
      stop: "all",
    })
    if (!playRes.ok) {
      console.warn(
        lyncrLog("telnyx-cc-hold-playback-start-failed", {
          callControlId,
          mode: label,
          error: playRes.error,
          status: playRes.status,
          musicUrl: playOpts.audioUrl || null,
          mediaName: playOpts.mediaName || null,
          usedPlaybackContent: Boolean(playOpts.playbackContent),
          gatherToMusicMs: Date.now() - gatherEndedAtMs,
        })
      )
      if (/no longer active/i.test(playRes.error || "")) return false
      return false
    }
    // Music is audible now — log before gather so latency metrics are honest.
    logMusicStarted(label, {
      musicUrl: playOpts.audioUrl || null,
      mediaName: playOpts.mediaName || null,
      usedPlaybackContent: Boolean(playOpts.playbackContent),
    })
    const gatherRes = await telnyxCallControlGather(callControlId, {
      clientState: encoded,
      timeoutMillis: repromptMs,
      maximumDigits: 1,
      validDigits: "12",
    })
    if (gatherRes.ok) return true
    console.warn(
      lyncrLog("telnyx-cc-hold-gather-after-playback-failed", {
        callControlId,
        mode: label,
        error: gatherRes.error,
        musicUrl: playOpts.audioUrl || null,
      })
    )
    // Music may still be looping even if gather failed — treat as partial success.
    if (!/no longer active/i.test(gatherRes.error || "")) return true
    return false
  }

  // 1) Inline classic-hold clip — fastest path (cached base64, no disk/network on warm
  // instance), but it's only ~7.5s looped. Worth that repetition on the very first entry
  // (getting SOME audio going before any Telnyx→lyncr.app round trip matters there); every
  // resume after a reprompt/intake speak instead reaches for the full-length preset first
  // (step 3 below) — looping the same 7.5s clip for an entire multi-minute hold was the
  // "music sounds cheap" complaint. Still tried as a step-3.5 fallback on resumes too.
  const inline = loadHoldMusicPlaybackContentBase64()
  if (isFastFirstEntry && inline) {
    if (await tryPlaybackThenGather("playback_content", { playbackContent: inline })) return true
  }

  // Optional Neon settings only if inline failed and caller did not skip (custom URL path).
  if (!opts?.skipAccountFetch && accountMusicUrl == null) {
    const accountSettings = await getAccountHoldSettings(state.userId).catch(() => ({
      holdMusicUrl: null as string | null,
      holdMaxWaitSecs: null as number | null,
      holdRepromptSecs: null as number | null,
    }))
    accountMusicUrl = accountSettings.holdMusicUrl
    accountRepromptSecs = state.holdRepromptSecs ?? accountSettings.holdRepromptSecs
    accountMaxWait = state.holdMaxWaitSecs ?? accountSettings.holdMaxWaitSecs
    musicCandidates = resolveHoldMusicUrlCandidates(accountMusicUrl)
    repromptMs = holdRePromptIntervalMs(accountRepromptSecs)
    nextState.holdMaxWaitSecs = holdMaxWaitSecs(accountMaxWait)
    nextState.holdRepromptSecs = accountRepromptSecs ?? undefined
    encoded = encodeTelnyxCallControlState(nextState)
  }

  console.log(
    lyncrLog("telnyx-cc-hold-music-resolve", {
      callControlId,
      musicUrl: musicCandidates[0] || null,
      candidates: musicCandidates.slice(0, 6),
      mediaName: mediaName || null,
      accountOverride: accountMusicUrl || null,
      repromptMs,
      gatherToResolveMs: Date.now() - gatherEndedAtMs,
    })
  )

  // 2) Telnyx Media Storage when env is set.
  if (mediaName) {
    if (await tryPlaybackThenGather("media_name", { mediaName })) return true
  }

  // 3) Public HTTPS WAV URLs — the account's real preset (20-25s loop, not 7.5s).
  for (const musicUrl of musicCandidates) {
    const ok = await tryPlaybackThenGather("playback_start+gather", { audioUrl: musicUrl })
    if (ok) return true
  }

  // 3.5) Resume path deliberately skipped inline above — still better than dead air
  // if every other music source failed.
  if (!isFastFirstEntry && inline) {
    if (await tryPlaybackThenGather("playback_content", { playbackContent: inline })) return true
  }

  // 4) Last resort: gather_using_audio (historically flaky — keep as backup).
  for (const musicUrl of musicCandidates.slice(0, 3)) {
    const audioGather = await telnyxCallControlGatherUsingAudio(callControlId, {
      audioUrl: musicUrl,
      clientState: encoded,
      timeoutMillis: repromptMs,
      maximumDigits: 1,
      validDigits: "12",
    })
    if (audioGather.ok) {
      logMusicStarted("gather_using_audio", { musicUrl })
      return true
    }
    console.warn(
      lyncrLog("telnyx-cc-hold-music-gather-failed", {
        callControlId,
        error: audioGather.error,
        musicUrl,
        status: audioGather.status,
      })
    )
    if (/no longer active/i.test(audioGather.error || "")) {
      console.warn(lyncrLog("telnyx-cc-hold-music-skip-dead-call", { callControlId, musicUrl }))
      return false
    }
  }

  if (!musicCandidates.length && !mediaName && !inline) {
    console.warn(
      lyncrLog("telnyx-cc-hold-music-url-missing", {
        callControlId,
        hint: "Set hold music preset, LYNCR_HOLD_MUSIC_URL, or LYNCR_HOLD_MUSIC_MEDIA_NAME",
      })
    )
  }

  // No music (or all paths failed) — speak a short hold line and wait for press 1.
  const text = await buildHoldRepromptText(state, callControlId)
  const fallbackVoice = await resolveHoldSpeakVoice(state)
  console.log(
    lyncrLog("telnyx-cc-hold-music-fallback-speak", {
      callControlId,
      speakVoice: fallbackVoice || null,
    })
  )
  const speakGather = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text,
    clientState: encoded,
    maximumDigits: 1,
    validDigits: "12",
    timeoutMillis: repromptMs,
    maximumTries: 1,
    voice: fallbackVoice || "Telnyx.NaturalHD.astra",
  })
  if (!speakGather.ok) {
    console.error(lyncrLog("telnyx-cc-hold-speak-gather-failed", { error: speakGather.error }))
    if (!/no longer active/i.test(speakGather.error || "")) {
      await finishHoldWithoutSms(callControlId, state)
    }
    return false
  }
  return false
}

/** Stop music briefly for a short consistent reminder, then gather for press 1. */
async function startHoldRepromptGather(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  if (holdTimedOut(state)) {
    await finishHoldWithSms(callControlId, state, "timed_out")
    return
  }

  // Brief pause only — same short script every time (not a second Busy greeting).
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)

  // Highest priority of all — a specific vehicle on file (customer_vehicles), asked about
  // directly and only once. Never phrased as "we recognize you"; reads like an ordinary
  // targeted question ("if you're calling about your 2016 Chrysler 200, press 1"). Recognition
  // still only ever changes ROUTING here, never spoken acknowledgment — requested directly.
  if (state.holdVehicleOnFile && !state.holdVehicleConfirmOffered) {
    await startVehicleConfirmGather(callControlId, state)
    return
  }

  const promptCount = (state.holdPromptCount ?? 0) + 1

  // Smart hold, in order of priority per reprompt cycle:
  //  1) Phase 1 — one industry-tailored multiple-choice question. Retries up to
  //     MAX_INTAKE_ATTEMPTS times (once more, one cycle later) if unanswered — a caller
  //     who missed it the first time (still settling in, mid hold-music transition) gets
  //     one more shot instead of it being gone for the rest of the call.
  //  2) Phase 2 — a numeric follow-up, only if Phase 1's answer queued one
  //     (holdIntakeFollowUp); same retry allowance if the answer never came, or came in
  //     incomplete (fewer than the full digit count).
  //  3) the original generic "press 1 for a text" reprompt, unchanged.
  let intakePrompt: HoldQueueIntakePrompt | null = null
  const intakeAnswered = Boolean(state.holdIntakeAnswered)
  const intakeAttempts = state.holdIntakeAttempts ?? 0
  let industryHasNoPrompt = false
  const followUpAnswered = Boolean(state.holdIntakeFollowUpAnswered)
  // A new call needs a new answer. Reusing an earlier call's intent made silence
  // look like completed intake, skipped the vehicle question, and falsely thanked
  // callers for details they had not given on this call.

  if (!intakeAnswered && intakeAttempts < MAX_INTAKE_ATTEMPTS) {
    try {
      const user = await getUser(state.userId)
      intakePrompt = resolveHoldQueueIntakePrompt(user?.industry)
      if (!intakePrompt) industryHasNoPrompt = true
    } catch (e) {
      console.warn(lyncrLog("telnyx-cc-hold-intake-industry-lookup-failed", { error: String(e) }))
      // Fail closed — don't keep retrying the lookup itself every cycle for the rest of the call.
      industryHasNoPrompt = true
    }
  }
  const followUpAttempts = state.holdIntakeFollowUpAttempts ?? 0
  const isVehicleZipFollowUp = state.holdIntakeFollowUp?.fieldKey === "job_address_postal_code"
  let askFollowUp =
    !intakePrompt &&
    !followUpAnswered &&
    followUpAttempts < MAX_INTAKE_ATTEMPTS &&
    Boolean(state.holdIntakeFollowUp) &&
    // Ask ZIP after a confirmed vehicle or when speech transcription is unavailable.
    (!isVehicleZipFollowUp || !state.holdVehicleVoiceRequired || Boolean(state.holdVehicleVoiceConfirmed) || !process.env.TELNYX_API_KEY?.trim())

  // Phase 3 completeness check — nothing higher-priority is being asked this cycle,
  // so verify the spoken year/make/model actually landed: read a good capture back
  // for confirmation, retry a failed/late/garbled clip (capped), run the ask if an
  // earlier failure skipped it, or move to ZIP when voice is exhausted.
  if (
    !intakePrompt &&
    intakeAnswered &&
    isVehicleZipFollowUp &&
    Boolean(state.holdVehicleVoiceRequired) &&
    Boolean(process.env.TELNYX_API_KEY?.trim()) &&
    !(state.holdVehicleVoiceConfirmed && followUpAnswered)
  ) {
    const collected = await getCallQueueCollectedByCallControlId(callControlId).catch(
      () => ({}) as Record<string, unknown>
    )
    const pending = collected.vehicle_voice_pending === true
    const recordedAt = state.holdVehicleVoiceRecordedAtMs ?? 0
    const step = resolveHoldVehicleVoiceStep({
      isVehicleIntent: true,
      attempts: holdVehicleVoiceAttemptCount(state),
      confirmed: Boolean(state.holdVehicleVoiceConfirmed),
      confirmAsks: state.holdVehicleVoiceConfirmAsks ?? 0,
      transcriptionPending: pending,
      pendingIsStale: pending && recordedAt > 0 && Date.now() - recordedAt > VEHICLE_VOICE_PENDING_STALE_MS,
      capturedMake:
        typeof collected.vehicle_make === "string" ? collected.vehicle_make : null,
      zipFallbackAnswered: followUpAnswered,
    })
    const stepState: TelnyxCallControlClientState = { ...state, holdPromptCount: promptCount }
    if (step === "confirm") {
      await startVehicleVoiceReadbackConfirm(callControlId, stepState, collected)
      return
    }
    if (step === "ask" || step === "retry") {
      const started = await startHoldVehicleVoicePrompt(callControlId, stepState, {
        retry: step === "retry",
      })
      if (started) return
      // Prompt failed — fall through to the ordinary reprompt below.
    }
    if (step === "zip_fallback" && !followUpAnswered && followUpAttempts < MAX_INTAKE_ATTEMPTS) {
      askFollowUp = true
    }
  }

  const say = intakePrompt
    ? intakePrompt.text
    : askFollowUp
      ? state.holdIntakeFollowUp!.text
      : await buildHoldRepromptText(
          {
            ...state,
            holdPromptCount: promptCount,
            holdIntakeAnswered: intakeAnswered,
            holdIntakeFollowUpAnswered: followUpAnswered,
            holdIntakeSummary: state.holdIntakeSummary,
          },
          callControlId
        )

  // Same premium voice as the Busy gather.
  const speakVoice = await resolveHoldSpeakVoice(state)

  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdPromptCount: promptCount,
    holdSpeakVoice: speakVoice,
    holdIntakeAnswered: intakeAnswered || industryHasNoPrompt,
    holdIntakeAttempts: intakePrompt ? intakeAttempts + 1 : intakeAttempts,
    holdAwaitingIntakeAnswer: Boolean(intakePrompt),
    holdIntakeFollowUpAnswered: followUpAnswered,
    holdIntakeFollowUpAttempts: askFollowUp ? followUpAttempts + 1 : followUpAttempts,
    holdAwaitingIntakeFollowUpAnswer: askFollowUp,
    holdIntakeSummary: state.holdIntakeSummary,
    holdIntakeUrgent: state.holdIntakeUrgent,
  }

  console.log(
    lyncrLog("telnyx-cc-hold-reprompt-speak", {
      callControlId,
      speakVoice: speakVoice || null,
      promptCount,
      textLen: say.length,
      intake: Boolean(intakePrompt),
      intakeFollowUp: askFollowUp,
    })
  )

  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: say,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: intakePrompt ? 1 : askFollowUp ? state.holdIntakeFollowUp!.maxDigits : 1,
    // Follow-up wants any digit 0-9 (gather_using_speak's own default) — everything
    // else keeps its original, narrower valid set unchanged. "12" (not "1") once intake
    // is answered — the reprompt copy at this point offers press-2-for-callback too, and
    // a caller pressing 2 here was getting rejected as invalid DTMF and stuck on repeat.
    validDigits: intakePrompt ? holdQueueIntakeValidDigits(intakePrompt) : askFollowUp ? undefined : "12",
    // Follow-up (multi-digit) needs real time to dial digits. Phase-1's multiple-choice
    // question gets more than the plain single "press 1" reminder too — the caller just
    // heard 2-3 options and needs a beat to decide, not just react; 6s was clipping real
    // presses (silently dropped as a "timeout", never acknowledged, never captured).
    timeoutMillis: intakePrompt ? 9_000 : askFollowUp ? 10_000 : 6_000,
    // One short reminder only — never Telnyx’s default 3× replay.
    maximumTries: 1,
    voice: speakVoice || "Telnyx.NaturalHD.astra",
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, nextState)
  }
}

/**
 * Ask directly about the specific vehicle on file (state.holdVehicleOnFile) — the very first
 * thing offered on the first reprompt cycle when we have one, ahead of the generic industry
 * intake question. Marked "offered" immediately so it's never asked twice, whichever way the
 * caller answers.
 */
async function startVehicleConfirmGather(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  const speakVoice = await resolveHoldSpeakVoice(state)
  const promptCount = (state.holdPromptCount ?? 0) + 1
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdPromptCount: promptCount,
    holdSpeakVoice: speakVoice,
    holdVehicleConfirmOffered: true,
    holdAwaitingVehicleConfirm: true,
  }
  console.log(lyncrLog("telnyx-cc-hold-vehicle-confirm-start", { callControlId }))
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: holdVehicleConfirmPrompt(state.holdVehicleOnFile!),
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 1,
    validDigits: "12",
    timeoutMillis: 9_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, nextState)
  }
}

/**
 * gather.ended answering the vehicle-confirm question. Press 1 (yes, that's the vehicle) asks
 * whether anything's changed; press 2 or silence falls through to current-call
 * intake. Never treat silence as confirmation of a previous job.
 * Fall through to the normal reprompt/intake logic for this cycle exactly as if
 * there'd been no vehicle on file at all (holdVehicleConfirmOffered is already true on state
 * so this never re-asks).
 */
async function handleVehicleConfirmAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = { ...state, holdAwaitingVehicleConfirm: false }
  if (digits === "1") {
    await startVehicleChangedGather(callControlId, baseState)
    return
  }
  await startHoldRepromptGather(callControlId, baseState)
}

/** Confirmed same vehicle — find out if there's anything new before deciding what to offer. */
async function startVehicleChangedGather(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  const speakVoice = await resolveHoldSpeakVoice(state)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdSpeakVoice: speakVoice,
    holdAwaitingVehicleChangedAnswer: true,
  }
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: HOLD_VEHICLE_CHANGED_PROMPT,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 1,
    validDigits: "12",
    timeoutMillis: 9_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, nextState)
  }
}

/**
 * gather.ended answering "has anything changed". Press 1 (yes) sends a link;
 * press 2 (no) moves to wait or callback. Silence does not assert "no change".
 */
async function handleVehicleChangedAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = { ...state, holdAwaitingVehicleChangedAnswer: false }
  if (digits === "1") {
    await leaveHoldQueueWithSms(callControlId, baseState, "cc_busy_hold_vehicle_changed")
    return
  }
  if (digits !== "2") {
    await startHoldRepromptGather(callControlId, baseState)
    return
  }

  const speakVoice = baseState.holdSpeakVoice || (await resolveHoldSpeakVoice(baseState))
  const nextState: TelnyxCallControlClientState = {
    ...baseState,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdSpeakVoice: speakVoice,
    holdIntakeAnswered: true,
    holdIntakeFollowUpAnswered: true,
  }
  console.log(lyncrLog("telnyx-cc-hold-vehicle-no-change", { callControlId }))
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: HOLD_VEHICLE_NO_CHANGE_REPROMPT,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 1,
    validDigits: "12",
    timeoutMillis: 6_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, nextState)
  }
}

/** Press 1 while on hold — leave queue, SMS, confirm, hangup. */
async function leaveHoldQueueWithSms(
  callControlId: string,
  state: TelnyxCallControlClientState,
  source: string
): Promise<void> {
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status: "sms_left" })

  const { outcome } = await sendInboundBookingSmsAndTag({
    fromE164: state.callerE164,
    ownerUserId: state.userId,
    businessLineE164: state.businessLineE164,
    callSid: callControlId,
    routedToName: CAPTURE_STATUS_HOLD_PRESS1,
    source,
    tone: "booking_link",
    intake: await holdIntakeSmsContext(callControlId, state),
  })

  const confirmState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_sms_confirm_end",
    dialReason: "busy_automation",
  })
  const speakRes = await telnyxCallControlSpeak(
    callControlId,
    bookingSmsConfirmSpeech(outcome, "press1", {
      callerDisplayName: state.callerDisplayName,
      intakeSummary: state.holdIntakeSummary,
    }),
    confirmState
  )
  if (!speakRes.ok) {
    await telnyxCallControlHangup(callControlId)
  }
}

/** Speak a phone number digit-by-digit (clearer to verify aloud than a run-together number). */
function spellPhoneDigitsForSpeech(e164: string): string {
  const digits = e164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  return digits.split("").join(" ")
}

/**
 * Press 2 while on hold — offer a callback instead of waiting, confirming the caller's own
 * number first (or letting them type a different one) before handing off to
 * finalizeCallbackRequest. Requested directly: a caller who's already given their details
 * shouldn't just sit through hold music with no other option.
 */
async function startCallbackConfirm(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  const speakVoice = await resolveHoldSpeakVoice(state)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdSpeakVoice: speakVoice,
    holdAwaitingCallbackConfirm: true,
  }
  const spelledNumber = spellPhoneDigitsForSpeech(state.callerE164)
  const text = spelledNumber
    ? `We'll call you back at ${spelledNumber}. If that's right, press 1. To use a different number instead, press 2.`
    : "Press 1 to confirm we should call the number you're on now, or press 2 to use a different number."
  console.log(lyncrLog("telnyx-cc-hold-callback-confirm-start", { callControlId }))
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 1,
    validDigits: "12",
    timeoutMillis: 10_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, { ...state, holdSpeakVoice: speakVoice })
  }
}

/** gather.ended answering the callback-number confirm (press 1 = correct, press 2 = type a different one). */
async function handleCallbackConfirmAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = { ...state, holdAwaitingCallbackConfirm: false }
  if (digits === "2") {
    await startCallbackNumberCapture(callControlId, baseState)
    return
  }
  // "1", a timeout, or anything else unrecognized — default to the number they're calling
  // from rather than leaving them stuck in a confirm loop.
  await finalizeCallbackRequest(callControlId, baseState, baseState.callerE164)
}

/** Ask for a replacement callback number, 10 digits terminated by #. */
async function startCallbackNumberCapture(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  const speakVoice = await resolveHoldSpeakVoice(state)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdSpeakVoice: speakVoice,
    holdAwaitingCallbackNumber: true,
  }
  console.log(lyncrLog("telnyx-cc-hold-callback-number-start", { callControlId }))
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: "Okay, type the 10-digit number to call you back on, then press pound.",
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 10,
    validDigits: "0123456789",
    timeoutMillis: 15_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await finalizeCallbackRequest(callControlId, state, state.callerE164)
  }
}

/**
 * gather.ended answering the replacement callback number. Any 10+ digit answer is used
 * as-is; a short/empty one (timeout, gave up mid-entry) falls back to the caller's own
 * number rather than leaving the request stuck.
 */
async function handleCallbackNumberAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = { ...state, holdAwaitingCallbackNumber: false }
  const normalized = digits.length >= 10 ? normalizePhoneNumberE164(digits) : ""
  const callbackNumber = normalized || baseState.callerE164
  await finalizeCallbackRequest(callControlId, baseState, callbackNumber)
}

/**
 * Leave the queue and save a callback lead — same mechanism as AI-intake leads (Lead
 * Salvage queue + owner SMS alert via saveCallIntake), carrying forward whatever the
 * caller already answered on hold. A callback here is a promise a human will call back,
 * not an automatic redial — the lead is how the team finds out to actually do it.
 */
async function finalizeCallbackRequest(
  callControlId: string,
  state: TelnyxCallControlClientState,
  callbackE164: string
): Promise<void> {
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status: "left" })

  const collected = await getCallQueueCollectedByCallControlId(callControlId)
  const intentSlug = typeof collected.intent_slug === "string" ? collected.intent_slug : null
  const summary = state.holdIntakeSummary
    ? `Callback requested — ${state.holdIntakeSummary}`
    : "Callback requested while on hold"

  await saveCallIntake({
    user_id: state.userId,
    caller_e164: callbackE164,
    intent_slug: intentSlug,
    collected: { ...collected, callback_requested: true, callback_number: callbackE164 },
    summary,
    vapi_call_id: null,
  }).catch((e) => console.warn(lyncrLog("telnyx-cc-hold-callback-save-failed", { error: String(e) })))

  console.log(lyncrLog("telnyx-cc-hold-callback-requested", { callControlId, callbackE164 }))

  const speakVoice = await resolveHoldSpeakVoice(state)
  const confirmState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_sms_confirm_end",
    dialReason: "busy_automation",
  })
  const speakRes = await telnyxCallControlSpeak(
    callControlId,
    "Got it — we'll call you back within a few minutes. Thanks for your patience!",
    confirmState,
    { voice: speakVoice }
  )
  if (!speakRes.ok) {
    await telnyxCallControlHangup(callControlId)
  }
}

/**
 * Max-wait AI eligibility — Professional/Business tier (`087`) AND an AI Assistant already
 * configured. Checked fresh at every max-wait so a mid-call downgrade never bridges a call
 * the account no longer pays for; any lookup failure fails closed (falls back to SMS).
 */
async function resolveHoldAiBridgeEligibility(
  userId: string
): Promise<{ allowed: boolean; assistantId: string }> {
  try {
    const entitlement = await resolveAiVoiceAssistantEntitlement(userId)
    if (!entitlement.allowed) return { allowed: false, assistantId: "" }
    const user = await getUser(userId)
    const assistantId = user?.telnyx_ai_assistant_id?.trim() || ""
    return { allowed: Boolean(assistantId), assistantId }
  } catch (e) {
    console.warn(lyncrLog("telnyx-cc-hold-ai-eligibility-failed", { userId, error: String(e) }))
    return { allowed: false, assistantId: "" }
  }
}

/**
 * Max-wait reached. Paid tier + AI Assistant configured → bridge into a live AI conversation
 * (see call.conversation.ended handling in telnyx-call-control-inbound.ts for the wrap-up SMS).
 * Otherwise, and on any AI-start failure, falls back to the original one-soft-booking-SMS
 * behavior (never used for hangup / leave without press 1) — a paid-tier account never ends
 * up worse off than the free path.
 */
async function finishHoldWithSms(
  callControlId: string,
  state: TelnyxCallControlClientState,
  status: "timed_out"
): Promise<void> {
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status })

  const aiEligibility = await resolveHoldAiBridgeEligibility(state.userId)
  if (aiEligibility.allowed) {
    const nextState: TelnyxCallControlClientState = {
      ...state,
      phase: "await_ai_assistant_hold",
      aiAssistantStartedAtMs: Date.now(),
    }
    const startRes = await telnyxCallControlStartAiAssistant(callControlId, {
      assistantId: aiEligibility.assistantId,
      clientState: encodeTelnyxCallControlState(nextState),
    })
    if (startRes.ok) {
      await updateCallLog(callControlId, { routed_to_name: CAPTURE_STATUS_HOLD_AI_ASSISTED }).catch(
        () => undefined
      )
      console.log(lyncrLog("telnyx-cc-hold-ai-bridged", { callControlId }))
      return
    }
    console.warn(
      lyncrLog("telnyx-cc-hold-ai-start-failed", { callControlId, error: startRes.error })
    )
    // Fall through — caller still gets the guaranteed booking-link SMS below.
  }

  const { outcome } = await sendInboundBookingSmsAndTag({
    fromE164: state.callerE164,
    ownerUserId: state.userId,
    businessLineE164: state.businessLineE164,
    callSid: callControlId,
    // NOT press-1 — the system gave up on the wait. Tagging this as "Booked from
    // hold · press 1" is exactly the mislabel that sent a real investigation the
    // wrong way (caller had simply out-waited the 10-min max hold).
    routedToName: CAPTURE_STATUS_HOLD_TIMEOUT_SMS,
    source: "cc_busy_hold_max_wait",
    tone: "hold_timeout",
    intake: await holdIntakeSmsContext(callControlId, state),
  })

  const confirmState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_sms_confirm_end",
    dialReason: "busy_automation",
  })
  const speakRes = await telnyxCallControlSpeak(
    callControlId,
    bookingSmsConfirmSpeech(outcome, "max_wait", {
      callerDisplayName: state.callerDisplayName,
      intakeSummary: state.holdIntakeSummary,
    }),
    confirmState
  )
  if (!speakRes.ok) {
    await telnyxCallControlHangup(callControlId)
  }
}

/** Leave hold without texting (gather failure / internal cleanup — hangup is not press 1). */
async function finishHoldWithoutSms(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status: "left" })
  await telnyxCallControlHangup(callControlId)
  void state
}

/**
 * Caller hung up — cleanup Neon + Telnyx queue, then kick abandoned-hold rescue
 * (immediate booking link unless after-hours + complete intake, which waits 15 min).
 * Called unconditionally on every inbound hangup (even with stale/missing client_state,
 * to guarantee ghost "holding" rows clear) — including the NORMAL end of a call that was
 * already answered from the queue. Without the status check below, that hangup silently
 * overwrote a correctly-recorded "answered" row back to "left", corrupting
 * answered-vs-abandoned reporting (confirmed live: 6 rows had a real answered_at but only
 * 1 still showed status="answered"). Only ever downgrades a row still "waiting"/"holding".
 */
export async function abandonHoldQueue(callControlId: string): Promise<void> {
  // Caller already hung up; mark terminal so leave_queue is skipped or treated as 90018 race.
  markTelnyxCallControlTerminal(callControlId)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  const liveStatus = await getCallQueueStatusByCallControlId(callControlId).catch(() => null)
  if (liveStatus && liveStatus !== "waiting" && liveStatus !== "holding") return
  await updateCallQueueStatus({ callControlId, status: "left" })
  // Early hangups get the booking-link rescue right away (after-hours + complete
  // intake still waits 15 min via cron). Fire-and-forget — never block hangup cleanup.
  void import("@/lib/abandoned-hold-rescue")
    .then(({ tryImmediateAbandonedHoldRescue }) => tryImmediateAbandonedHoldRescue(callControlId))
    .catch((e) =>
      console.warn(lyncrLog("abandon-rescue-immediate-kick-failed", { error: String(e) }))
    )
}

/**
 * gather.ended answering the Phase-1 hold-queue intake question (not the plain
 * "press 1" reprompt). A matched digit is captured to call_queue.collected —
 * broadcasting it to Lines so the operator sees it before pressing Answer — then
 * acknowledged with a short "Got it" and hold music resumes. If that option queues a
 * Phase-2 numeric follow-up (service ZIP), it's stashed on state for the very
 * next reprompt cycle. An unmatched digit or timeout leaves holdIntakeAnswered false —
 * startHoldRepromptGather's attempt cap decides whether a later cycle retries, rather
 * than this being a permanent one-shot.
 */
async function handleHoldIntakeAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = {
    ...state,
    holdAwaitingIntakeAnswer: false,
  }

  let matched: { intentSlug: string; label: string; followUp?: HoldQueueIntakeFollowUp; vehicleVoice?: boolean } | null = null
  try {
    const user = await getUser(state.userId)
    const prompt = resolveHoldQueueIntakePrompt(user?.industry)
    const option = prompt && digits ? resolveHoldQueueIntakeOption(prompt, digits) : null
    if (option) {
      matched = { intentSlug: option.intentSlug, label: option.label, followUp: option.followUp, vehicleVoice: option.vehicleVoice }
    }
  } catch (e) {
    console.warn(lyncrLog("telnyx-cc-hold-intake-resolve-failed", { error: String(e) }))
  }

  if (!matched) {
    console.log(
      lyncrLog("telnyx-cc-hold-intake-skipped", { callControlId, digits: digits || null })
    )
    await startHoldMusicGather(callControlId, baseState)
    return
  }

  // A real answer — lock it in so no later cycle re-asks this.
  baseState.holdIntakeAnswered = true
  baseState.holdIntakeSummary = matched.label
  baseState.holdIntakeUrgent = isUrgentHoldQueueIntentSlug(matched.intentSlug)
  baseState.holdVehicleVoiceRequired = Boolean(matched.vehicleVoice)

  if (matched.followUp) {
    baseState.holdIntakeFollowUp = matched.followUp
  }

  await mergeCallQueueCollected(callControlId, {
    intent_slug: matched.intentSlug,
    intent_label: matched.label,
  }).catch((e) => console.warn(lyncrLog("telnyx-cc-hold-intake-collect-failed", { error: String(e) })))

  console.log(
    lyncrLog("telnyx-cc-hold-intake-captured", { callControlId, intentSlug: matched.intentSlug })
  )

  // A queued follow-up used to wait for the NEXT full reprompt cycle (45-90s of music
  // away) before it was ever asked — long enough that callers had usually forgotten the
  // first question, or the operator had already answered, so it read as "never asked
  // again." Ask it now, in the same turn, while the topic is still fresh.
  //
  // Capture year/make/model by voice when transcription is configured. Without it,
  // go straight to ZIP rather than recording an answer we cannot understand.
  if (matched.followUp?.fieldKey === "job_address_postal_code" && matched.vehicleVoice) {
    if (!process.env.TELNYX_API_KEY?.trim()) {
      await speakHoldIntakeFollowUpNow(callControlId, baseState, matched.followUp)
      return
    }
    const started = await startHoldVehicleVoicePrompt(callControlId, baseState, {})
    if (started) return
    await speakHoldIntakeFollowUpNow(callControlId, baseState, matched.followUp)
    return
  }

  if (matched.followUp) {
    await speakHoldIntakeFollowUpNow(callControlId, baseState, matched.followUp)
    return
  }

  await speakHoldAckThenMusic(
    callControlId,
    alertOwnerForCapturedHoldIntake(callControlId, baseState),
    "Got it, thanks — hang tight."
  )
}

/**
 * Ask for service ZIP immediately after the service answer or vehicle read-back,
 * instead of waiting for the next reprompt cycle. No music plays between the two — the
 * Phase-1 gather already stopped it before speaking.
 */
async function speakHoldIntakeFollowUpNow(
  callControlId: string,
  state: TelnyxCallControlClientState,
  followUp: HoldQueueIntakeFollowUp
): Promise<void> {
  const speakVoice = await resolveHoldSpeakVoice(state)
  const attempts = (state.holdIntakeFollowUpAttempts ?? 0) + 1
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdSpeakVoice: speakVoice,
    holdIntakeFollowUpAttempts: attempts,
    holdAwaitingIntakeFollowUpAnswer: true,
  }
  console.log(
    lyncrLog("telnyx-cc-hold-intake-followup-immediate", { callControlId, fieldKey: followUp.fieldKey, attempt: attempts })
  )
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: followUp.text,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: followUp.maxDigits,
    timeoutMillis: 10_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, { ...state, holdSpeakVoice: speakVoice, holdIntakeFollowUpAttempts: attempts })
  }
}

/**
 * gather.ended answering the ZIP follow-up. Any digits
 * at all are accepted as-is and merged (a caller who only gets 3 of 4 digits in before
 * the inter-digit timeout still gives the operator something useful), but only a FULL
 * answer (every digit) marks it as answered — a partial or empty answer leaves
 * holdIntakeFollowUpAnswered false so a later cycle retries for a complete one instead
 * of treating a partial ZIP as final.
 */
async function handleHoldIntakeFollowUpAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = {
    ...state,
    holdAwaitingIntakeFollowUpAnswer: false,
  }
  const followUp = state.holdIntakeFollowUp

  if (!digits || !followUp) {
    console.log(
      lyncrLog("telnyx-cc-hold-intake-followup-skipped", { callControlId, digits: digits || null })
    )
    await startHoldMusicGather(callControlId, baseState)
    return
  }

  if (digits.length >= followUp.maxDigits) {
    baseState.holdIntakeFollowUpAnswered = true
    baseState.holdIntakeSummary = baseState.holdIntakeSummary
      ? `${baseState.holdIntakeSummary} — ${followUp.fieldLabel} ${digits}`
      : `${followUp.fieldLabel} ${digits}`
  }

  await mergeCallQueueCollected(callControlId, {
    [followUp.fieldKey]: digits,
    [`${followUp.fieldKey}_label`]: `${followUp.fieldLabel} ${digits}`,
  }).catch((e) =>
    console.warn(lyncrLog("telnyx-cc-hold-intake-followup-collect-failed", { error: String(e) }))
  )

  console.log(
    lyncrLog("telnyx-cc-hold-intake-followup-captured", {
      callControlId,
      fieldKey: followUp.fieldKey,
      digitsLen: digits.length,
    })
  )

  const completedState = alertOwnerForCapturedHoldIntake(callControlId, baseState)
  if (baseState.holdIntakeFollowUpAnswered) {
    // Do not send the caller back to a full music cycle after the last answer.
    await startHoldRepromptGather(callControlId, completedState)
    return
  }
  await startHoldMusicGather(callControlId, completedState)
}

/** Voice-ask attempts so far — holdVehicleVoiceDone predates the counter, count it as one. */
function holdVehicleVoiceAttemptCount(state: TelnyxCallControlClientState): number {
  return state.holdVehicleVoiceAttempts ?? (state.holdVehicleVoiceDone ? 1 : 0)
}

/**
 * Phase 3 — speak the "say the make and model" ask (first ask or capped retry). The
 * recording itself starts on this speak's `call.speak.ended` (see
 * handleTelnyxCallControlVoiceWebhook), so the beep always lands AFTER the sentence
 * instead of over it. Returns false when the speak couldn't start — the caller then
 * resumes the music loop and a later reprompt cycle retries.
 */
async function startHoldVehicleVoicePrompt(
  callControlId: string,
  state: TelnyxCallControlClientState,
  opts: { retry?: boolean }
): Promise<boolean> {
  const speakVoice = await resolveHoldSpeakVoice(state)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_hold_vehicle_voice_prompt",
    holdSpeakVoice: speakVoice,
    holdVehicleVoiceDone: true,
    holdVehicleVoiceAttempts: holdVehicleVoiceAttemptCount(state) + 1,
    // A fresh capture gets a fresh read-back confirm.
    holdVehicleVoiceConfirmAsks: 0,
  }
  const text = opts.retry
    ? "Sorry — I didn't quite catch your vehicle. One more time: after the beep, say the year, make and model — for example, 2015 Toyota Camry. When you're done, press pound or just pause."
    : "After the beep, tell us the year, make and model of your vehicle — for example, 2015 Toyota Camry. When you're done, press pound or just pause."
  const res = await telnyxCallControlSpeak(callControlId, text, encodeTelnyxCallControlState(nextState), {
    voice: speakVoice,
  })
  if (!res.ok) {
    console.warn(
      lyncrLog("telnyx-cc-hold-vehicle-voice-prompt-failed", { callControlId, error: res.error })
    )
    return false
  }
  console.log(
    lyncrLog("telnyx-cc-hold-vehicle-voice-prompt", {
      callControlId,
      attempt: nextState.holdVehicleVoiceAttempts,
      retry: Boolean(opts.retry),
    })
  )
  return true
}

/** Max seconds of spoken make/model we record — roomy enough for a slow starter. */
const VEHICLE_VOICE_MAX_SECS = 12
/** Backstop gather that ends the recording step even if max_length is ignored. */
const VEHICLE_VOICE_BACKSTOP_MS = 14_000

/**
 * `call.speak.ended` for the Phase-3 ask — start the caller-only recording (the beep
 * signals "talk now"; inbound track keeps TTS/music out of the clip), then arm a plain
 * DTMF gather as the flow-control backstop: its gather.ended (pound, any digit, or the
 * 12s timeout) stops the recording and resumes hold music deterministically, without
 * depending on the recording webhook for call flow. The saved clip is transcribed
 * asynchronously by handleCallRecordingSaved (lib/telnyx-call-control-recording-saved.ts)
 * once Telnyx's call.recording.saved event lands on the main Call Control webhook.
 */
export async function startHoldVehicleVoiceRecording(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdAwaitingVehicleVoice: true,
  }
  // Mark BEFORE recording so handleCallRecordingSaved (lib/telnyx-call-control-recording-saved.ts)
  // knows this call.recording.saved is the vehicle answer, not a voicemail.
  await mergeCallQueueCollected(callControlId, { vehicle_voice_pending: true })

  const encoded = encodeTelnyxCallControlState(nextState)
  const rec = await telnyxCallControlRecordStart(callControlId, encoded, {
    playBeep: true,
    maxLengthSecs: VEHICLE_VOICE_MAX_SECS,
    recordingTrack: "inbound",
  })
  if (!rec.ok) {
    console.warn(
      lyncrLog("telnyx-cc-hold-vehicle-voice-record-failed", { callControlId, error: rec.error })
    )
    await startHoldMusicGather(callControlId, {
      ...state,
      phase: "await_busy_hold_loop",
      holdVehicleVoiceDone: true,
    })
    return
  }

  const gatherRes = await telnyxCallControlGather(callControlId, {
    clientState: encoded,
    timeoutMillis: VEHICLE_VOICE_BACKSTOP_MS,
  })
  if (!gatherRes.ok) {
    // No backstop event would ever resume music — stop now and keep the call moving.
    await telnyxCallControlRecordStop(callControlId).catch(() => undefined)
    await startHoldMusicGather(callControlId, {
      ...state,
      phase: "await_busy_hold_loop",
      holdVehicleVoiceDone: true,
    })
  }
}

/**
 * Speak a short ack and resume hold music only on that speak's `call.speak.ended`
 * (dispatched back into resumeHoldMusicAfterAckSpeak). Starting music in the same
 * turn cancelled the ack: startHoldMusicGather's playback_start uses stop:"all",
 * so the TTS died milliseconds in and callers heard music with no confirmation.
 * If the speak command itself is rejected, music resumes immediately —
 * `call.speak.failed` covers the async-failure path (see handleSpeakFailed).
 */
async function speakHoldAckThenMusic(
  callControlId: string,
  state: TelnyxCallControlClientState,
  text: string
): Promise<void> {
  const ackState: TelnyxCallControlClientState = { ...state, phase: "await_hold_ack_speak" }
  const res = await telnyxCallControlSpeak(callControlId, text, encodeTelnyxCallControlState(ackState), {
    voice: state.holdSpeakVoice,
  }).catch(() => null)
  if (!res?.ok) {
    await startHoldMusicGather(callControlId, { ...state, phase: "await_busy_hold_loop" })
  }
}

/** `call.speak.ended` / `call.speak.failed` for a hold ack — pick the music loop back up. */
export async function resumeHoldMusicAfterAckSpeak(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  await startHoldMusicGather(callControlId, { ...state, phase: "await_busy_hold_loop" })
}

/** Backstop gather ended (pound / digit / 12s timeout) — close the clip, resume music. */
async function finishHoldVehicleVoiceCapture(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  await telnyxCallControlRecordStop(callControlId).catch(() => undefined)
  const cleared: TelnyxCallControlClientState = {
    ...state,
    holdAwaitingVehicleVoice: false,
    holdVehicleVoiceDone: true,
    // Stamps the stale-transcription clock: pending past the window → retry.
    holdVehicleVoiceRecordedAtMs: Date.now(),
  }
  console.log(lyncrLog("telnyx-cc-hold-vehicle-voice-captured", { callControlId }))
  await speakHoldAckThenMusic(callControlId, cleared, "Thanks. I'll check those details now. Hang tight.")
}

/**
 * Read the captured vehicle back for a one-digit confirm ("2015 Toyota Camry —
 * press 1 if right, press 2 to say it again"). Wrong transcriptions were otherwise
 * silently trusted all the way into the booking form; asked at most
 * MAX_VEHICLE_VOICE_CONFIRM_ASKS times per capture — silence keeps the data,
 * just unconfirmed.
 */
async function startVehicleVoiceReadbackConfirm(
  callControlId: string,
  state: TelnyxCallControlClientState,
  collected: Record<string, unknown>
): Promise<void> {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")
  const vehicle = [str(collected.vehicle_year), str(collected.vehicle_make), str(collected.vehicle_model)]
    .filter(Boolean)
    .join(" ")
  const speakVoice = await resolveHoldSpeakVoice(state)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdPromptCount: (state.holdPromptCount ?? 0) + 1,
    holdSpeakVoice: speakVoice,
    holdAwaitingVehicleVoiceConfirm: true,
    holdVehicleVoiceConfirmAsks: (state.holdVehicleVoiceConfirmAsks ?? 0) + 1,
  }
  console.log(lyncrLog("telnyx-cc-hold-vehicle-voice-confirm-start", { callControlId }))
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: `Quick check — I have your vehicle as ${vehicle}. If that's right, press 1. To say it again, press 2.`,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 1,
    validDigits: "12",
    timeoutMillis: 9_000,
    maximumTries: 1,
    voice: speakVoice,
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, { ...state, holdSpeakVoice: speakVoice })
  }
}

function alertOwnerForCapturedHoldIntake(
  callControlId: string,
  state: TelnyxCallControlClientState
): TelnyxCallControlClientState {
  if (
    !isHoldIntakeFullyAnswered(state) ||
    !state.holdIntakeSummary ||
    state.holdIntakeCapturedAlerted ||
    (state.holdIntakeFollowUp?.fieldKey === "job_address_postal_code" && !state.holdIntakeFollowUpAnswered)
  ) return state

  const sendPromise = getCallQueueCollectedByCallControlId(callControlId)
    .then((collected) => saveCallIntake({
      user_id: state.userId,
      caller_e164: state.callerE164,
      intent_slug: typeof collected.intent_slug === "string" ? collected.intent_slug : null,
      collected,
      summary: `Caller on hold — ${state.holdIntakeSummary}`,
      vapi_call_id: callControlId,
    }))
    .then((result) => console.log(lyncrLog("telnyx-cc-hold-intake-alert-result", {
      callControlId,
      leadId: result.id,
      sent: result.sms_sent,
      error: result.sms_error,
    })))
    .catch((e) => console.warn(lyncrLog("hold-intake-captured-alert-failed", { callControlId, error: String(e) })))
  // Start the send now, and keep the webhook function alive until Telnyx responds.
  // A detached promise can be cut off as soon as the voice webhook returns.
  try {
    after(() => sendPromise)
  } catch (e) {
    console.warn(lyncrLog("hold-intake-alert-background-unavailable", { callControlId, error: String(e) }))
  }
  console.log(lyncrLog("telnyx-cc-hold-intake-lead-started", { callControlId }))
  return { ...state, holdIntakeCapturedAlerted: true }
}

/** gather.ended answering the make/model read-back (1 = right, 2 = redo the clip). */
async function handleVehicleVoiceConfirmAnswer(
  callControlId: string,
  state: TelnyxCallControlClientState,
  digits: string
): Promise<void> {
  const baseState: TelnyxCallControlClientState = {
    ...state,
    holdAwaitingVehicleVoiceConfirm: false,
  }

  if (digits === "2") {
    // Wrong capture — wipe it so the owner never acts on data the caller disowned,
    // then redo the clip (counts against the attempt cap; the redo path's own
    // startHoldVehicleVoicePrompt resets the per-capture confirm counter). A year
    // that came from the clip is wiped with it; a keypad-typed year is kept.
    const collected = await getCallQueueCollectedByCallControlId(callControlId).catch(
      () => ({}) as Record<string, unknown>
    )
    const yearWasVoice = collected.vehicle_year_source === "voice"
    await mergeCallQueueCollected(callControlId, {
      vehicle_make: null,
      vehicle_model: null,
      vehicle_make_model_label: null,
      vehicle_voice_transcript: null,
      vehicle_confirmed: null,
      ...(yearWasVoice
        ? { vehicle_year: null, vehicle_year_label: null, vehicle_year_source: null }
        : {}),
    })
    const started = await startHoldVehicleVoicePrompt(callControlId, baseState, { retry: true })
    if (!started) await startHoldMusicGather(callControlId, baseState)
    return
  }

  if (digits === "1") {
    const confirmedState: TelnyxCallControlClientState = {
      ...baseState,
      holdVehicleVoiceConfirmed: true,
    }
    void mergeCallQueueCollected(callControlId, { vehicle_confirmed: true }).catch(() => undefined)
    // Fold the confirmed vehicle into the running summary so the final spoken
    // read-back and the owner alert both carry it.
    try {
      const collected = await getCallQueueCollectedByCallControlId(callControlId)
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")
      const label = [str(collected.vehicle_year), str(collected.vehicle_make), str(collected.vehicle_model)]
        .filter(Boolean)
        .join(" ")
      if (str(collected.vehicle_year) && str(collected.vehicle_make) && str(collected.vehicle_model)) {
        confirmedState.holdIntakeSummary = confirmedState.holdIntakeSummary
          ? `${confirmedState.holdIntakeSummary} — ${label}`
          : label
      } else {
        confirmedState.holdVehicleVoiceConfirmed = false
      }
    } catch {
      confirmedState.holdVehicleVoiceConfirmed = false
    }
    console.log(lyncrLog("telnyx-cc-hold-vehicle-voice-confirmed", { callControlId }))
    // ZIP is still needed for dispatch. Ask it now, then offer a callback.
    if (confirmedState.holdIntakeFollowUp && !confirmedState.holdIntakeFollowUpAnswered) {
      await speakHoldIntakeFollowUpNow(callControlId, confirmedState, confirmedState.holdIntakeFollowUp)
      return
    }
    await startHoldRepromptGather(callControlId, alertOwnerForCapturedHoldIntake(callControlId, confirmedState))
    return
  }

  // Timeout / anything else — keep the capture, just unconfirmed (never nag twice).
  await startHoldMusicGather(callControlId, baseState)
}

/**
 * Best-effort recovery when handleHoldLoopGatherEnded itself throws (caller: the voice
 * webhook route already catches the exception and still ACKs 200 to Telnyx, so this is
 * the only thing standing between a bug here and a caller stuck in dead air with no
 * further prompts for the rest of the call). Restarts hold music with a fresh gather —
 * not a full re-derivation of whatever state the throw interrupted, just enough to keep
 * the call alive and moving instead of frozen.
 */
export async function recoverHoldLoopAfterError(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  await startHoldMusicGather(callControlId, {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "music",
  }).catch(() => undefined)
}

/**
 * gather.ended while phase is await_busy_hold_loop.
 * digit 1 → SMS leave; timeout → flip music ↔ re-prompt (or max-wait SMS).
 */
export async function handleHoldLoopGatherEnded(params: {
  callControlId: string
  state: TelnyxCallControlClientState
  digits: string
  gatherStatus: string
}): Promise<void> {
  const { callControlId, state, digits } = params
  const gatherStatus = String(params.gatherStatus || "").toLowerCase()
  console.log(
    lyncrLog("telnyx-cc-hold-gather-ended", {
      callControlId,
      digits: digits || null,
      gatherStatus: gatherStatus || null,
      holdSegment: state.holdSegment || null,
      holdPromptCount: state.holdPromptCount ?? 0,
    })
  )

  // A gather from the hold loop can still be pending when the agent answers — bridging
  // stops playback but a gather already in flight fires call.gather.ended anyway (and
  // gather_stop, called on bridge, produces one too). Its client_state.phase is stale
  // ("await_busy_hold_loop") because per-command client_state isn't retroactively updated,
  // so without this check a late gather-ended speaks a hold reprompt / restarts hold music
  // into a call that's already bridged to a live human. Bail out unless the queue row still
  // shows the caller actually on hold.
  const liveStatus = await getCallQueueStatusByCallControlId(callControlId)
  if (liveStatus && liveStatus !== "waiting" && liveStatus !== "holding") {
    console.log(
      lyncrLog("telnyx-cc-hold-gather-ended-stale", {
        callControlId,
        liveStatus,
        gatherStatus: gatherStatus || null,
      })
    )
    return
  }

  // Caller already left — do not restart music / SMS / hangup spam on a dead leg.
  if (
    gatherStatus === "call_hangup" ||
    gatherStatus === "cancelled" ||
    gatherStatus === "call_hangup_bye"
  ) {
    await abandonHoldQueue(callControlId)
    return
  }

  // Spoken make/model clip is recording — this gather.ended (pound, any digit, or
  // the backstop timeout) closes it and resumes music; digits here are never a
  // press-1 / reprompt answer.
  if (state.holdAwaitingVehicleVoice) {
    await finishHoldVehicleVoiceCapture(callControlId, state)
    return
  }

  // Make/model read-back confirm (1 = right, 2 = redo) — same state-before-digits
  // reasoning as every other awaiting flag below.
  if (state.holdAwaitingVehicleVoiceConfirm) {
    await handleVehicleVoiceConfirmAnswer(callControlId, state, digits)
    return
  }

  // These two vehicle-confirm sub-steps come first — same reasoning as every other
  // "check state before the plain press-1/press-2 reprompt digits" branch below.
  if (state.holdAwaitingVehicleConfirm) {
    await handleVehicleConfirmAnswer(callControlId, state, digits)
    return
  }

  if (state.holdAwaitingVehicleChangedAnswer) {
    await handleVehicleChangedAnswer(callControlId, state, digits)
    return
  }

  // This gather was the Phase-1 intake question, not the plain "press 1" reprompt —
  // check first so a caller pressing "1" to mean "vehicle" never gets misread as
  // "leave the queue and text me a link" below.
  if (state.holdAwaitingIntakeAnswer) {
    await handleHoldIntakeAnswer(callControlId, state, digits)
    return
  }

  // Same reasoning for the Phase-2 numeric follow-up — a 5-digit ZIP must never be
  // parsed as "press 1" just because it happens to start with a 1 (Telnyx only sends
  // the full collected string here, so this checks state, not the digits themselves).
  if (state.holdAwaitingIntakeFollowUpAnswer) {
    await handleHoldIntakeFollowUpAnswer(callControlId, state, digits)
    return
  }

  // Same reasoning again for the two callback sub-steps (confirm number / type a new one) —
  // check state before falling through to the plain "press 1 / press 2" reprompt digits.
  if (state.holdAwaitingCallbackConfirm) {
    await handleCallbackConfirmAnswer(callControlId, state, digits)
    return
  }

  if (state.holdAwaitingCallbackNumber) {
    await handleCallbackNumberAnswer(callControlId, state, digits)
    return
  }

  if (digits === "1") {
    await leaveHoldQueueWithSms(callControlId, state, "cc_busy_hold_press1")
    return
  }

  // Press 2 to request a callback instead of waiting — honored any time it's pressed,
  // even before the reprompt copy has explicitly offered it yet.
  if (digits === "2") {
    await startCallbackConfirm(callControlId, state)
    return
  }

  if (holdTimedOut(state)) {
    await finishHoldWithSms(callControlId, state, "timed_out")
    return
  }

  // One heads-up text to the owner the first time a caller crosses the halfway mark of
  // the max wait — still on hold, still hasn't hung up, so it's a real, waiting caller.
  let effectiveState = state
  if (
    !state.holdLongWaitAlerted &&
    holdElapsedMs(state) >= holdLongWaitAlertMs(state.holdMaxWaitSecs)
  ) {
    const waitedSecs = Math.round(holdElapsedMs(state) / 1000)
    void sendHoldLongWaitOwnerAlert({
      userId: state.userId,
      callerE164: state.callerE164,
      waitedSecs,
      urgent: state.holdIntakeUrgent,
    }).catch((e) => console.warn(lyncrLog("hold-long-wait-alert-failed", { error: String(e) })))
    console.log(lyncrLog("telnyx-cc-hold-long-wait-alert", { callControlId, waitedSecs }))
    effectiveState = { ...state, holdLongWaitAlerted: true }
  }

  // Recovery path for a completed intake whose immediate alert did not run.
  effectiveState = alertOwnerForCapturedHoldIntake(callControlId, effectiveState)

  // Music segment ended with no digit:
  // - "invalid" + empty digits was the production silence bug (clip rejected ~1s) —
  //   retry music instead of immediately speaking (which stopped any real audio).
  // - timeout → re-prompt as designed.
  if (effectiveState.holdSegment === "music") {
    if (gatherStatus === "invalid" || gatherStatus === "cancelled") {
      console.warn(
        lyncrLog("telnyx-cc-hold-music-invalid-retry", {
          callControlId,
          gatherStatus,
          note: "retry_playback_not_reprompt",
        })
      )
      await startHoldMusicGather(callControlId, effectiveState)
      return
    }
    await startHoldRepromptGather(callControlId, effectiveState)
    return
  }

  // Re-prompt timed out / invalid → music again.
  await startHoldMusicGather(callControlId, effectiveState)
}

/**
 * Agent leg answered from Lines — bridge to specific waiting caller or queue head.
 */
export async function bridgeAgentToHoldQueue(params: {
  agentCallControlId: string
  state: TelnyxCallControlClientState
}): Promise<void> {
  const { agentCallControlId, state } = params
  const queueName = state.holdQueueName || lyncrHoldQueueName(state.userId)
  const target = state.queueTargetCallControlId?.trim()

  if (target) {
    await telnyxCallControlPlaybackStop(target).catch(() => undefined)
    // Cancel any gather still armed from the hold loop (music/reprompt) so it can't
    // outlive the bridge and fire a stale call.gather.ended into the live call. This
    // alone isn't sufficient — gather_stop fires its own call.gather.ended — the real
    // backstop is the status guard in handleHoldLoopGatherEnded.
    await telnyxCallControlGatherStop(target).catch(() => undefined)
    // Harmless no-op when the AI never started — clears the way for a human answer
    // when the owner picks up mid AI-assisted-hold conversation.
    if (state.phase === "await_ai_assistant_hold") {
      await telnyxCallControlStopAiAssistant(target).catch(() => undefined)
    }
  }

  const bridgeRes = target
    ? await telnyxCallControlBridge(agentCallControlId, {
        callControlId: target,
        clientState: encodeTelnyxCallControlState({
          ...state,
          phase: "await_dial_end",
          dialReason: "queue_answer",
        }),
      })
    : await telnyxCallControlBridge(agentCallControlId, {
        queue: queueName,
        clientState: encodeTelnyxCallControlState({
          ...state,
          phase: "await_dial_end",
          dialReason: "queue_answer",
        }),
      })

  if (!bridgeRes.ok) {
    console.error(
      lyncrLog("telnyx-cc-queue-bridge-failed", {
        agentCallControlId,
        error: bridgeRes.error,
        queueName,
        target: target || null,
      })
    )
    await telnyxCallControlHangup(agentCallControlId)
    return
  }

  if (target) {
    await updateCallQueueStatus({
      callControlId: target,
      status: "answered",
      answeredByUserId: state.userId,
    })
  }

  console.log(
    lyncrLog("telnyx-cc-queue-bridged", {
      agentCallControlId,
      queueName,
      target: target || "queue-head",
    })
  )
}
