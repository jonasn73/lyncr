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

import {
  countWaitingCallQueue,
  getAccountHoldSettings,
  getCallQueuePosition,
  updateCallQueueStatus,
  upsertCallQueueWaiting,
} from "@/lib/call-queue-db"
import { getAccountPresence } from "@/lib/account-presence"
import {
  HOLD_MAX_WAIT_SMS_PROMPT,
  HOLD_REPROMPT_DEFAULT,
  holdMaxConcurrent,
  holdMaxWaitSecs,
  holdMusicMediaName,
  holdRePromptIntervalMs,
  lyncrHoldQueueName,
  resolveHoldMusicUrlCandidates,
} from "@/lib/hold-queue"
import { loadHoldMusicPlaybackContentBase64 } from "@/lib/hold-inline-audio"
import { CAPTURE_STATUS_HOLD_PRESS1, CAPTURE_STATUS_HOLD_QUEUE } from "@/lib/inbound-time-capture"
import { sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"
import { resolveSpeakVoiceForPersona } from "@/lib/ivr-automation-settings"
import { lyncrLog } from "@/lib/lyncr-env"
import {
  telnyxCallControlBridge,
  telnyxCallControlGather,
  telnyxCallControlGatherUsingAudio,
  telnyxCallControlGatherUsingSpeak,
  telnyxCallControlHangup,
  telnyxCallControlLeaveQueue,
  telnyxCallControlPlaybackStart,
  telnyxCallControlPlaybackStop,
  telnyxCallControlSpeak,
} from "@/lib/telnyx-call-control-api"
import {
  encodeTelnyxCallControlState,
  type TelnyxCallControlClientState,
} from "@/lib/telnyx-call-control-state"
import { updateCallLog } from "@/lib/db"

type RoutingLike = { user_id: string; owner_phone?: string | null }

/** Tag Activity as Hold Queue (best-effort — never block voice). */
async function tagHoldQueueCallLog(callControlId: string): Promise<void> {
  try {
    await updateCallLog(callControlId, {
      routed_to_name: CAPTURE_STATUS_HOLD_QUEUE,
      status: "in-progress",
    })
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
  return `${HOLD_REPROMPT_DEFAULT}${hint}`
}

/**
 * After Busy gather timeout (stay on line) — music ASAP + Neon queue for Lines Answer.
 * Press 1 on the *first* Busy menu still SMS+hangups (handled by inbound before this).
 *
 * Soft-hold intentionally skips Telnyx `enqueue` so media is not parked/cleared —
 * Answer bridges by stored `call_control_id` (see /api/calls/queue/answer).
 */
export async function enterBusyHoldQueue(params: {
  callControlId: string
  state: TelnyxCallControlClientState
  routing: RoutingLike
  callSessionId?: string | null
}): Promise<void> {
  const { callControlId, state, routing } = params
  const userId = routing.user_id || state.userId

  // Cap concurrent holds so orphaned legs / minutes don't runaway.
  const waiting = await countWaitingCallQueue(userId).catch(() => 0)
  if (waiting >= holdMaxConcurrent()) {
    console.log(
      lyncrLog("telnyx-cc-hold-cap-reached", {
        callControlId,
        userId,
        waiting,
        cap: holdMaxConcurrent(),
      })
    )
    await sendInboundBookingSmsAndTag({
      fromE164: state.callerE164,
      ownerUserId: userId,
      businessLineE164: state.businessLineE164,
      callSid: callControlId,
      routedToName: CAPTURE_STATUS_HOLD_PRESS1,
      source: "cc_busy_hold_cap",
      tone: "hold_timeout",
    })
    const confirmState = encodeTelnyxCallControlState({
      ...state,
      phase: "await_busy_sms_confirm_end",
      dialReason: "busy_automation",
    })
    await telnyxCallControlSpeak(callControlId, HOLD_MAX_WAIT_SMS_PROMPT, confirmState)
    return
  }

  const queueName = lyncrHoldQueueName(userId)
  const holdStartedAtMs = state.holdStartedAtMs || Date.now()
  // Snapshot hold settings in parallel with nothing else — keep this fast.
  const holdSettings = await getAccountHoldSettings(userId).catch(() => ({
    holdMusicUrl: null,
    holdMaxWaitSecs: null,
    holdRepromptSecs: null,
  }))
  const maxWait = holdMaxWaitSecs(holdSettings.holdMaxWaitSecs)
  const nextState: TelnyxCallControlClientState = {
    ...state,
    userId,
    phase: "await_busy_hold_loop",
    dialReason: "busy_automation",
    holdQueueName: queueName,
    holdStartedAtMs,
    holdPromptCount: 0,
    holdSegment: "music",
    holdMaxWaitSecs: maxWait,
    holdRepromptSecs: holdSettings.holdRepromptSecs ?? undefined,
    inboundCallControlId: state.inboundCallControlId || callControlId,
  }

  // 1) Music FIRST — do not wait on Neon / Telnyx queue before the caller hears audio.
  const musicOk = await startHoldMusicGather(callControlId, nextState)

  // 2) Lines Answer list (Neon) — not on the critical path for audio.
  await upsertCallQueueWaiting({
    userId,
    callControlId,
    callSessionId: params.callSessionId,
    callerE164: state.callerE164,
    businessLineE164: state.businessLineE164,
  })
  await tagHoldQueueCallLog(callControlId)

  console.log(
    lyncrLog("telnyx-cc-hold-entered", {
      callControlId,
      userId,
      queueName,
      enqueued: false,
      softHoldNoTelnyxEnqueue: true,
      musicStarted: musicOk,
    })
  )
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
export async function startHoldMusicGather(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<boolean> {
  if (holdTimedOut(state)) {
    await finishHoldWithSms(callControlId, state, "timed_out")
    return false
  }

  const accountSettings = await getAccountHoldSettings(state.userId).catch(() => ({
    holdMusicUrl: null,
    holdMaxWaitSecs: null,
    holdRepromptSecs: null,
  }))
  const musicCandidates = resolveHoldMusicUrlCandidates(accountSettings.holdMusicUrl)
  const mediaName = holdMusicMediaName()
  const repromptMs = holdRePromptIntervalMs(
    state.holdRepromptSecs ?? accountSettings.holdRepromptSecs
  )
  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "music",
    holdMaxWaitSecs: state.holdMaxWaitSecs ?? holdMaxWaitSecs(accountSettings.holdMaxWaitSecs),
    holdRepromptSecs: state.holdRepromptSecs ?? accountSettings.holdRepromptSecs ?? undefined,
  }
  const encoded = encodeTelnyxCallControlState(nextState)

  console.log(
    lyncrLog("telnyx-cc-hold-music-resolve", {
      callControlId,
      musicUrl: musicCandidates[0] || null,
      candidates: musicCandidates.slice(0, 6),
      mediaName: mediaName || null,
      accountOverride: accountSettings.holdMusicUrl || null,
      repromptMs,
    })
  )

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
        })
      )
      if (/no longer active/i.test(playRes.error || "")) return false
      return false
    }
    const gatherRes = await telnyxCallControlGather(callControlId, {
      clientState: encoded,
      timeoutMillis: repromptMs,
      maximumDigits: 1,
      validDigits: "1",
    })
    if (gatherRes.ok) {
      console.log(
        lyncrLog("telnyx-cc-hold-music-started", {
          callControlId,
          mode: label,
          musicUrl: playOpts.audioUrl || null,
          mediaName: playOpts.mediaName || null,
          usedPlaybackContent: Boolean(playOpts.playbackContent),
        })
      )
      return true
    }
    console.warn(
      lyncrLog("telnyx-cc-hold-gather-after-playback-failed", {
        callControlId,
        mode: label,
        error: gatherRes.error,
        musicUrl: playOpts.audioUrl || null,
      })
    )
    // Music may still be looping even if gather failed — treat as partial success.
    if (!/no longer active/i.test(gatherRes.error || "")) {
      console.log(
        lyncrLog("telnyx-cc-hold-music-started", {
          callControlId,
          mode: `${label}-playback-only`,
          musicUrl: playOpts.audioUrl || null,
          note: "gather_failed_music_may_still_play",
        })
      )
      return true
    }
    return false
  }

  // 1) Inline classic-hold clip — fastest path (Telnyx never fetches lyncr.app).
  const inline = loadHoldMusicPlaybackContentBase64()
  if (inline) {
    if (await tryPlaybackThenGather("playback_content", { playbackContent: inline })) return true
  }

  // 2) Telnyx Media Storage when env is set.
  if (mediaName) {
    if (await tryPlaybackThenGather("media_name", { mediaName })) return true
  }

  // 3) Public HTTPS WAV URLs.
  for (const musicUrl of musicCandidates) {
    const ok = await tryPlaybackThenGather("playback_start+gather", { audioUrl: musicUrl })
    if (ok) return true
  }

  // 4) Last resort: gather_using_audio (historically flaky — keep as backup).
  for (const musicUrl of musicCandidates.slice(0, 3)) {
    const audioGather = await telnyxCallControlGatherUsingAudio(callControlId, {
      audioUrl: musicUrl,
      clientState: encoded,
      timeoutMillis: repromptMs,
      maximumDigits: 1,
      validDigits: "1",
    })
    if (audioGather.ok) {
      console.log(
        lyncrLog("telnyx-cc-hold-music-started", {
          callControlId,
          mode: "gather_using_audio",
          musicUrl,
        })
      )
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
  let fallbackVoice = state.holdSpeakVoice?.trim() || ""
  if (!fallbackVoice) {
    try {
      const presence = await getAccountPresence(state.userId)
      fallbackVoice = resolveSpeakVoiceForPersona(presence.ivrVoiceEngineModel)
    } catch {
      fallbackVoice = "Telnyx.NaturalHD.astra"
    }
  }
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
    validDigits: "1",
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
export async function startHoldRepromptGather(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  if (holdTimedOut(state)) {
    await finishHoldWithSms(callControlId, state, "timed_out")
    return
  }

  // Brief pause only — same short script every time (not a second Busy greeting).
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)

  const promptCount = (state.holdPromptCount ?? 0) + 1
  // Always the same short line (+ optional “you're next”); never HOLD_AWARE_BUSY_PROMPT again.
  const say = await buildHoldRepromptText({ ...state, holdPromptCount: promptCount }, callControlId)

  // Same premium voice as Busy gather — snapshot, then live persona, then NaturalHD astra.
  let speakVoice = state.holdSpeakVoice?.trim() || ""
  if (!speakVoice) {
    try {
      const presence = await getAccountPresence(state.userId)
      speakVoice = resolveSpeakVoiceForPersona(presence.ivrVoiceEngineModel)
    } catch {
      speakVoice = "Telnyx.NaturalHD.astra"
    }
  }

  const nextState: TelnyxCallControlClientState = {
    ...state,
    phase: "await_busy_hold_loop",
    holdSegment: "reprompt",
    holdPromptCount: promptCount,
    holdSpeakVoice: speakVoice || state.holdSpeakVoice,
  }

  console.log(
    lyncrLog("telnyx-cc-hold-reprompt-speak", {
      callControlId,
      speakVoice: speakVoice || null,
      promptCount,
      textLen: say.length,
    })
  )

  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: say,
    clientState: encodeTelnyxCallControlState(nextState),
    maximumDigits: 1,
    validDigits: "1",
    // Short window after the reminder — then back to music quickly.
    timeoutMillis: 6_000,
    // One short reminder only — never Telnyx’s default 3× replay.
    maximumTries: 1,
    voice: speakVoice || "Telnyx.NaturalHD.astra",
  })
  if (!gatherRes.ok) {
    await startHoldMusicGather(callControlId, nextState)
  }
}

/** Press 1 while on hold — leave queue, SMS, confirm, hangup. */
export async function leaveHoldQueueWithSms(
  callControlId: string,
  state: TelnyxCallControlClientState,
  source: string
): Promise<void> {
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status: "sms_left" })

  await sendInboundBookingSmsAndTag({
    fromE164: state.callerE164,
    ownerUserId: state.userId,
    businessLineE164: state.businessLineE164,
    callSid: callControlId,
    routedToName: CAPTURE_STATUS_HOLD_PRESS1,
    source,
    tone: "booking_link",
  })

  const confirmState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_sms_confirm_end",
    dialReason: "busy_automation",
  })
  const speakRes = await telnyxCallControlSpeak(
    callControlId,
    "We just texted you a booking link. You can hang up whenever you're ready.",
    confirmState
  )
  if (!speakRes.ok) {
    await telnyxCallControlHangup(callControlId)
  }
}

/** Max-wait only — one soft booking SMS (never used for hangup / leave without press 1). */
async function finishHoldWithSms(
  callControlId: string,
  state: TelnyxCallControlClientState,
  status: "timed_out"
): Promise<void> {
  await telnyxCallControlPlaybackStop(callControlId).catch(() => undefined)
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status })

  await sendInboundBookingSmsAndTag({
    fromE164: state.callerE164,
    ownerUserId: state.userId,
    businessLineE164: state.businessLineE164,
    callSid: callControlId,
    routedToName: CAPTURE_STATUS_HOLD_PRESS1,
    source: "cc_busy_hold_max_wait",
    tone: "hold_timeout",
  })

  const confirmState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_sms_confirm_end",
    dialReason: "busy_automation",
  })
  const speakRes = await telnyxCallControlSpeak(callControlId, HOLD_MAX_WAIT_SMS_PROMPT, confirmState)
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

/** Caller hung up while waiting — cleanup Neon + Telnyx queue (no auto SMS). */
export async function abandonHoldQueue(callControlId: string): Promise<void> {
  await telnyxCallControlLeaveQueue(callControlId).catch(() => undefined)
  await updateCallQueueStatus({ callControlId, status: "left" })
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

  // Caller already left — do not restart music / SMS / hangup spam on a dead leg.
  if (
    gatherStatus === "call_hangup" ||
    gatherStatus === "cancelled" ||
    gatherStatus === "call_hangup_bye"
  ) {
    await abandonHoldQueue(callControlId)
    return
  }

  if (digits === "1") {
    await leaveHoldQueueWithSms(callControlId, state, "cc_busy_hold_press1")
    return
  }

  if (holdTimedOut(state)) {
    await finishHoldWithSms(callControlId, state, "timed_out")
    return
  }

  // Music segment ended with no digit:
  // - "invalid" + empty digits was the production silence bug (clip rejected ~1s) —
  //   retry music instead of immediately speaking (which stopped any real audio).
  // - timeout → re-prompt as designed.
  if (state.holdSegment === "music") {
    if (gatherStatus === "invalid" || gatherStatus === "cancelled") {
      console.warn(
        lyncrLog("telnyx-cc-hold-music-invalid-retry", {
          callControlId,
          gatherStatus,
          note: "retry_playback_not_reprompt",
        })
      )
      await startHoldMusicGather(callControlId, state)
      return
    }
    await startHoldRepromptGather(callControlId, state)
    return
  }

  // Re-prompt timed out / invalid → music again.
  await startHoldMusicGather(callControlId, state)
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
