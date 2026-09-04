// Inbound Call Control pipeline: call.initiated → answer → call.answered → speak → speak.ended → dial (+ A-leg US ringback).

import { getAppUrl } from "@/lib/telnyx"
import {
  markTelnyxCallControlTerminal,
  telnyxCallControlAnswer,
  telnyxCallControlBridge,
  telnyxCallControlClientStateUpdate,
  telnyxCallControlDial,
  telnyxCallControlGatherUsingSpeak,
  telnyxCallControlHangup,
  telnyxCallControlPlaybackStart,
  telnyxCallControlPlaybackStop,
  telnyxCallControlRecordStart,
  telnyxCallControlSpeak,
  telnyxListActiveCalls,
} from "@/lib/telnyx-call-control-api"
import {
  abandonHoldQueue,
  bridgeAgentToHoldQueue,
  enterBusyHoldQueue,
  handleCallEnqueuedHoldMusic,
  handleHoldLoopGatherEnded,
  kickHoldMusicPlaybackImmediate,
} from "@/lib/telnyx-call-control-hold-queue"
import { prefetchHoldMusicPlaybackContent } from "@/lib/hold-inline-audio"
import {
  loadUsRingbackPlaybackContentBase64,
  prefetchUsRingbackPlaybackContent,
} from "@/lib/us-ringback-inline-audio"
import { upsertCallQueueBusyMenu, updateCallQueueStatus } from "@/lib/call-queue-db"
import {
  HOLD_AWARE_BUSY_PROMPT,
  callerGreetingPrefix,
  sanitizeCallerNameForSpeech,
} from "@/lib/hold-queue"
import { resolveRepeatCallerUrgency } from "@/lib/repeat-caller-urgency"
import { envFlagOn, lyncrLog } from "@/lib/lyncr-env"
import { parseTelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"
import {
  encodeTelnyxCallControlState,
  type TelnyxCallControlClientState,
  type TelnyxCallControlDialReason,
} from "@/lib/telnyx-call-control-state"
import {
  forgetOutboundDialLeg,
  lookupOutboundDialLeg,
  rememberOutboundDialLeg,
} from "@/lib/telnyx-call-control-leg-map"
import {
  buildInboundCallerGreetingText,
  isInboundCallerGreetingEnabled,
  resolveWorkspaceDisplayName,
} from "@/lib/inbound-branded-greeting"
import { getOrCreateCallControlApp } from "@/lib/telnyx-call-control-config"
import {
  finalizeCallControlCallLog,
  isDialNoAnswerHangup,
  isOutboundDialLegEvent,
  persistCallControlBridged,
  persistCallControlDialNoAnswer,
  resolveInboundCallLogSid,
} from "@/lib/telnyx-call-control-call-log"
import {
  buildHoldFallbackAmdDetectionConfig,
  fallbackNeedsCarrierVmGuard,
  readInboundDialRingbackAudioUrl,
  resolveAmdMinMachineAgeForRingSec,
  resolveInboundForwardDialTimeoutSeconds,
} from "@/lib/telnyx-inbound-media-quality"
import { resolveInboundOutboundCallerId } from "@/lib/telnyx-pstn-dial-callerid"
import { resolveVoicemailGreetingText } from "@/lib/voicemail-greeting"
import { isAccountRoutingBlocked, parseAccountStatus } from "@/lib/account-status"
import {
  CAPTURE_DEFAULT_RING_E164,
  CAPTURE_STATUS_BUSY_MENU,
  CAPTURE_STATUS_HOLD_AI_ASSISTED,
  CAPTURE_STATUS_HOLD_PRESS1,
  resolveInboundCapturePlan,
  TIED_UP_BOOKING_PROMPT,
} from "@/lib/inbound-time-capture"
import { resolveInboundDialPlan, type InboundDialPlanResult } from "@/lib/inbound-dial-plan"
import { sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"
import { reportAiAssistantMinutesUsage } from "@/lib/ai-usage-billing"
import { markIvrActionCompleted } from "@/lib/booking-sms-guards"
import {
  getAccountPresence,
  resolvePresenceAutomationGreeting,
} from "@/lib/account-presence"
import {
  elevenLabsNaturalHdFallback,
  markElevenLabsSpeakFailed,
  preferWorkingSpeakVoice,
} from "@/lib/elevenlabs-voices"
import {
  digitsMatchIvrBypass,
  resolveAutomationGatherNumDigits,
  resolveHolidayGreetingText,
  resolveSpeakVoiceForPersona,
} from "@/lib/ivr-automation-settings"
import {
  getActivePhoneNumberByE164,
  getIncomingRoutingForVoiceWebhook,
  getRoutingConfigForNumber,
  insertCallLog,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"

/** Fail-safe forward target when routing DB lookup crashes or returns empty. */
const FAILSAFE_PRIMARY_CELL_E164 = CAPTURE_DEFAULT_RING_E164 // +15022602716

/**
 * Same-instance guard: speak.failed + speak.ended can both try to Dial after a flaky
 * ElevenLabs greet. Prevents double PSTN legs on one inbound.
 */
const greetingContinueStarted = new Set<string>()

type IncomingRoutingRow = NonNullable<Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>>

/** Minimal routing used when Neon lookup fails — still answers + dials the primary cell. */
function buildFailsafeRouting(params: {
  userId: string
  businessLineE164: string
  ownerPhone?: string | null
}): IncomingRoutingRow {
  const owner =
    (params.ownerPhone && isReasonablePstnDialString(normalizePhoneNumberE164(params.ownerPhone))
      ? normalizePhoneNumberE164(params.ownerPhone)
      : "") || FAILSAFE_PRIMARY_CELL_E164
  return {
    user_id: params.userId,
    user_name: "",
    business_name: "Key Squad 502",
    inbound_receptionist_whisper_enabled: true,
    owner_phone: owner,
    selected_receptionist_id: null,
    fallback_type: "voicemail",
    ring_timeout_seconds: 30,
    ai_ring_owner_first: false,
    receptionist_name: null,
    receptionist_phone: null,
    receptionist_routing_endpoint: "CELL",
    receptionist_sip_username: null,
    phone_line_label: "Main Line",
    phone_line_friendly_name: "",
    account_status: "active",
    active_phone_count: 1,
    primary_phone_number: params.businessLineE164 || FAILSAFE_PRIMARY_CELL_E164,
    admin_routing_override_phone: null,
    organization_name: "Key Squad 502",
    inbound_caller_greeting_enabled: false,
    forward_original_caller_id: false,
  }
}

/**
 * Resolve line routing for Call Control. Never throws — falls back to primary cell
 * so a missing column / workspace typo cannot 500 the webhook.
 */
async function resolveCallControlRouting(toRaw: string): Promise<IncomingRoutingRow | null> {
  const businessLineE164 = normalizePhoneNumberE164(toRaw) || toRaw
  console.log(
    JSON.stringify({
      zing: "telnyx-cc-resolve-routing-start",
      toRaw,
      businessLineE164,
    })
  )
  try {
    const routing = await getIncomingRoutingForVoiceWebhook(businessLineE164 || toRaw)
    if (routing) {
      console.log(
        JSON.stringify({
          zing: "telnyx-cc-resolve-routing-hit",
          userId: routing.user_id,
          organizationName: routing.organization_name,
        })
      )
      return routing
    }
    console.log(JSON.stringify({ zing: "telnyx-cc-resolve-routing-miss", businessLineE164 }))
  } catch (error) {
    console.error("Telnyx call.initiated routing lookup failed:", error)
  }

  // Second chance: phone_numbers row alone (lighter query) → failsafe owner dial.
  try {
    const line = await getActivePhoneNumberByE164(businessLineE164 || toRaw)
    if (line?.user_id) {
      console.log(
        JSON.stringify({
          zing: "telnyx-cc-resolve-routing-line-fallback",
          userId: line.user_id,
        })
      )
      return buildFailsafeRouting({
        userId: line.user_id,
        businessLineE164: line.number || businessLineE164,
        ownerPhone: null,
      })
    }
  } catch (error) {
    console.error("Telnyx call.initiated line lookup failed:", error)
  }

  console.warn(JSON.stringify({ zing: "telnyx-cc-resolve-routing-null", businessLineE164 }))
  return null
}

function normalizeDirection(direction: string): string {
  return direction.trim().toLowerCase()
}

function isInboundDirection(direction: string): boolean {
  const d = normalizeDirection(direction)
  return d === "incoming" || d === "inbound"
}

/** True only for clearly outbound legs — empty/unknown direction must NOT skip Answer. */
function isClearlyOutboundDirection(direction: string): boolean {
  const d = normalizeDirection(direction)
  return d === "outgoing" || d === "outbound"
}

function isTelnyxAuthFailureMessage(error: string): boolean {
  const e = error.toLowerCase()
  return (
    e.includes("no key found matching") ||
    e.includes("authentication failed") ||
    e.includes("invalid api key") ||
    e.includes("unauthorized") ||
    e.includes("401")
  )
}

/** Map shared planner → Call Control dial fields. */
function toCallControlDialFields(plan: InboundDialPlanResult): {
  dialTargetE164: string | null
  receptionistId: string | null
  routedToName: string | null
  reason: TelnyxCallControlDialReason
} {
  const reason = (plan.reason === "lyncr_pool" ? "failsafe" : plan.reason) as TelnyxCallControlDialReason
  return {
    dialTargetE164: plan.dialTargetE164,
    receptionistId: plan.receptionistId,
    routedToName: plan.routedToName,
    reason,
  }
}

/** Shared planner wrapper — same rules as TeXML `/incoming`. */
async function resolveCallControlInboundDialPlan(
  routing: IncomingRoutingRow,
  businessLineE164: string,
  excludeCallControlId?: string | null,
  opts?: { skipOwnerLiveCallCheck?: boolean }
): Promise<ReturnType<typeof toCallControlDialFields>> {
  const plan = await resolveInboundDialPlan({
    userId: routing.user_id,
    businessLineE164,
    ownerPhone: routing.owner_phone,
    preferredReceptionistId: routing.selected_receptionist_id,
    legacyReceptionistId: routing.selected_receptionist_id,
    legacyReceptionistPhone: routing.receptionist_phone,
    legacyReceptionistName: routing.receptionist_name,
    excludeCallControlId,
    skipOwnerLiveCallCheck: opts?.skipOwnerLiveCallCheck,
  })
  return toCallControlDialFields(plan)
}

/**
 * Busy / miss → Gather menu (parity with TeXML capture).
 * Press 1 → booking SMS. Timeout / stay on line → hold queue (music + Lines Answer).
 * After-hours (CLOSED) / holiday → same Gather, but timeout goes straight to SMS (no long hold).
 * Press 2 / bypass → dial owner cell.
 */
async function startBusyAutomationFlow(
  callControlId: string,
  state: TelnyxCallControlClientState,
  routing: IncomingRoutingRow
): Promise<void> {
  // Soft default matches real hold-queue behavior (stay on line = wait, not hangup).
  let say = HOLD_AWARE_BUSY_PROMPT
  let maxDigits = 1
  // AI Voice Persona from Greetings → Call Control Speak voice (NaturalHD / Polly).
  let speakVoice: string | undefined
  // Recognize a caller who already tried and got missed/dropped earlier today, and a saved
  // name if they're a known customer — both computed once here, carried in state for the
  // hold reprompts / SMS confirmation, never re-queried mid-hold. Independent try/catch
  // blocks are deliberate: a problem with one lookup must never also zero out the other.
  let isRepeatCaller = false
  let callerDisplayName = ""
  try {
    const { listTodaysCallLogsForCaller } = await import("@/lib/db")
    const todaysLogs = await listTodaysCallLogsForCaller(routing.user_id, state.callerE164)
    isRepeatCaller = resolveRepeatCallerUrgency(state.callerE164, todaysLogs, {
      excludeCallId: callControlId,
    }).isHighUrgency
  } catch (e) {
    console.warn("[telnyx-cc] repeat-caller lookup skipped:", e)
  }
  try {
    const { getCustomerByPhoneForUser } = await import("@/lib/db")
    const customer = await getCustomerByPhoneForUser(routing.user_id, state.callerE164)
    callerDisplayName = sanitizeCallerNameForSpeech(customer?.display_name)
  } catch (e) {
    console.warn("[telnyx-cc] customer-name lookup skipped:", e)
  }
  try {
    const presence = await getAccountPresence(routing.user_id)
    // Holiday window wins when active (TeXML parity).
    const holidaySay = resolveHolidayGreetingText({
      holidayOverrideStart: presence.holidayOverrideStart,
      holidayOverrideEnd: presence.holidayOverrideEnd,
      holidayGreetingText: presence.holidayGreetingText,
    })
    say =
      holidaySay ||
      resolvePresenceAutomationGreeting({
        presenceStatus: presence.presenceStatus,
        onJobGreetingText: presence.onJobGreetingText,
        closedGreetingText: presence.closedGreetingText,
      })
    // Ensure press-1 instructions exist even when custom greeting is short.
    const lower = say.toLowerCase()
    if (!lower.includes("press 1") && !lower.includes("press one")) {
      say = `${say.trim()} Press 1 and we'll text you a short form, or stay on the line.`
    }
    maxDigits = resolveAutomationGatherNumDigits(presence.ivrBypassCode)
    // Circuit / kill-switch may already prefer NaturalHD over broken ElevenLabs.
    speakVoice = preferWorkingSpeakVoice(resolveSpeakVoiceForPersona(presence.ivrVoiceEngineModel))
  } catch (e) {
    console.warn("[telnyx-cc] busy greeting lookup skipped:", e)
  }
  // Additive courtesy prefix — never replaces a custom greeting, just acknowledges a known
  // customer by name and/or that they already tried before this exact same script.
  const greetingPrefix = callerGreetingPrefix({ callerDisplayName, isRepeatCaller })
  if (greetingPrefix) {
    say = `${greetingPrefix}${say.trim()}`
  }
  // After speak.failed → gather invalid, force the NaturalHD voice we already chose.
  if (state.busySpeakFallbackTried) {
    speakVoice = preferWorkingSpeakVoice(state.holdSpeakVoice || speakVoice || "Telnyx.NaturalHD.astra")
  }
  // Last-resort audible voice if persona lookup failed entirely.
  const voiceForGather = speakVoice || "Telnyx.NaturalHD.astra"
  const nextState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_gather_end",
    dialTargetE164: undefined,
    dialReason: "busy_automation",
    // Snapshot persona so hold rempromts use the same premium voice (not a fallback).
    holdSpeakVoice: voiceForGather,
    busySpeakFallbackTried: state.busySpeakFallbackTried,
    isRepeatCaller,
    callerDisplayName: callerDisplayName || undefined,
  })
  console.log(
    lyncrLog("telnyx-cc-busy-automation-gather", {
      callControlId,
      userId: routing.user_id,
      maxDigits,
      speakVoice: voiceForGather,
      maximumTries: 1,
    })
  )
  // Await Busy-menu preview so hangup/press-1 can mark the row left (not a late ghost INSERT).
  try {
    await upsertCallQueueBusyMenu({
      userId: routing.user_id,
      callControlId,
      callerE164: state.callerE164,
      businessLineE164: state.businessLineE164,
    })
  } catch (e) {
    console.warn(lyncrLog("telnyx-cc-busy-menu-queue-preview-failed", { error: String(e) }))
  }
  // Leave "ringing" ASAP so Incoming Call / New Intake closes (Available miss → hold path).
  void (async () => {
    try {
      const { updateCallLog, getCallLogSnapshotForTelemetry } = await import("@/lib/db")
      await updateCallLog(callControlId, {
        routed_to_name: CAPTURE_STATUS_BUSY_MENU,
        status: "in-progress",
        answered_at: null,
      })
      const snapshot = await getCallLogSnapshotForTelemetry(callControlId).catch(() => null)
      if (!snapshot?.id || !snapshot.from_number) return
      const { broadcastCallHoldPathEntered } = await import("@/lib/call-telemetry-realtime")
      await broadcastCallHoldPathEntered({
        ownerUserId: snapshot.user_id,
        callSid: callControlId,
        callLogId: snapshot.id,
        fromNumber: snapshot.from_number,
        toNumber: snapshot.to_number,
        organizationId: snapshot.organization_id,
        routedToName: CAPTURE_STATUS_BUSY_MENU,
      })
    } catch (e) {
      console.warn(lyncrLog("telnyx-cc-busy-menu-tag-failed", { error: String(e) }))
    }
  })()
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: say,
    clientState: nextState,
    maximumDigits: maxDigits,
    timeoutMillis: 8000,
    // Telnyx defaults to 3 tries — that replayed the full Busy greeting before music.
    maximumTries: 1,
    voice: voiceForGather,
  })
  if (!gatherRes.ok) {
    console.error(lyncrLog("telnyx-cc-busy-gather-failed", { error: gatherRes.error }))
    // HTTP path failed even after NaturalHD/Polly chain — SMS then hang up (not silence).
    await sendInboundBookingSmsAndTag({
      fromE164: state.callerE164,
      ownerUserId: routing.user_id,
      businessLineE164: state.businessLineE164,
      callSid: callControlId,
      routedToName: CAPTURE_STATUS_HOLD_PRESS1,
      source: "cc_busy_gather_fail",
      businessLabel: resolveWorkspaceDisplayName(routing),
    })
    await telnyxCallControlHangup(callControlId)
  }
}

/**
 * ElevenLabs often returns HTTP 200 on Speak / gather_using_speak, then fires
 * call.speak.failed (free plan / bad key). Open the circuit so later legs use NaturalHD.
 *
 * Available connect greet: if Speak fails after Answer, Dial the cell immediately —
 * otherwise callers hear silence and the phone never rings (Busy gather already retries).
 */
async function handleSpeakFailed(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  const priorVoice = state?.holdSpeakVoice || ""
  console.error(
    lyncrLog("telnyx-cc-speak-failed", {
      callControlId: event.callControlId,
      phase: state?.phase ?? null,
      holdSpeakVoice: priorVoice || null,
      dialStatus: event.dialStatus || null,
    })
  )
  if (/^ElevenLabs\./i.test(priorVoice) || !priorVoice) {
    markElevenLabsSpeakFailed("call.speak.failed")
  }

  // Branded Available greeting died — skip TTS retry and ring the promised cell.
  if (
    state &&
    (state.phase === "await_greeting_end" || state.phase === "await_caller_answered")
  ) {
    console.warn(
      lyncrLog("telnyx-cc-greeting-speak-failed-recover-dial", {
        callControlId: event.callControlId,
        phase: state.phase,
        dialTargetTail4: String(state.dialTargetE164 || "")
          .replace(/\D/g, "")
          .slice(-4) || null,
      })
    )
    await continueAfterInboundGreeting(event, state)
  }
}

/**
 * After connect greeting (speak.ended) or failed greeting (speak.failed) — Dial PSTN
 * or start Busy automation. Soft-busy is not re-checked here (decided at Answer).
 */
async function continueAfterInboundGreeting(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>,
  state: TelnyxCallControlClientState
): Promise<void> {
  const inboundId = event.callControlId
  if (greetingContinueStarted.has(inboundId)) {
    console.log(
      lyncrLog("telnyx-cc-greeting-continue-skip-duplicate", {
        callControlId: inboundId,
        phase: state.phase,
      })
    )
    return
  }
  // Already dialed from a prior webhook on this (or another) instance.
  const existingOutbound = await lookupOutboundDialLeg(inboundId)
  if (existingOutbound) {
    console.log(
      lyncrLog("telnyx-cc-greeting-continue-skip-already-dialing", {
        callControlId: inboundId,
        outboundTail: existingOutbound.slice(-8),
      })
    )
    return
  }
  greetingContinueStarted.add(inboundId)

  let routing = await resolveCallControlRouting(state.businessLineE164)
  if (!routing) {
    routing = buildFailsafeRouting({
      userId: state.userId || "00000000-0000-0000-0000-000000000000",
      businessLineE164: state.businessLineE164,
      ownerPhone: state.dialTargetE164 || FAILSAFE_PRIMARY_CELL_E164,
    })
  }
  // Presence Busy can still divert to teammate / hold; soft-busy alone must not.
  const dialPlan = await resolveCallControlInboundDialPlan(
    routing,
    state.businessLineE164,
    event.callControlId,
    { skipOwnerLiveCallCheck: true }
  )
  let dialTargetE164 = dialPlan.dialTargetE164
  if (dialPlan.reason !== "busy_automation" && !isReasonablePstnDialString(dialTargetE164 || "")) {
    dialTargetE164 = state.dialTargetE164?.trim() || FAILSAFE_PRIMARY_CELL_E164
  }

  const nextState: TelnyxCallControlClientState = {
    ...state,
    userId: routing.user_id || state.userId,
    dialTargetE164: dialTargetE164 || undefined,
    fallbackType: routing.fallback_type ?? state.fallbackType,
    dialReason: dialPlan.reason,
    receptionistId: dialPlan.receptionistId || undefined,
  }

  console.log(
    JSON.stringify({
      zing: "telnyx-cc-speak-ended-dial-plan",
      callControlId: event.callControlId,
      planReason: dialPlan.reason,
      dialTargetTail4: dialTargetE164
        ? dialTargetE164.replace(/\D/g, "").slice(-4)
        : null,
      recvId: dialPlan.receptionistId,
    })
  )

  if (dialPlan.reason === "busy_automation" || !isReasonablePstnDialString(dialTargetE164 || "")) {
    await startBusyAutomationFlow(event.callControlId, nextState, routing)
    return
  }

  await dialTechnicianLeg(event.callControlId, nextState, routing)
}

/** After booking SMS — confirm and hang up (avoid double Busy greeting). */
async function confirmBusySmsAndHangup(
  callControlId: string,
  state: TelnyxCallControlClientState
): Promise<void> {
  const nextState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_sms_confirm_end",
    dialReason: "busy_automation",
  })
  const speakRes = await telnyxCallControlSpeak(callControlId, TIED_UP_BOOKING_PROMPT, nextState)
  if (!speakRes.ok) {
    console.error(JSON.stringify({ zing: "telnyx-cc-busy-sms-confirm-failed", error: speakRes.error }))
    await telnyxCallControlHangup(callControlId)
  }
}

function baseState(
  routing: NonNullable<Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>>,
  businessLineE164: string,
  callerE164: string,
  dialTargetE164: string,
  ringTimeoutSec: number,
  phase: TelnyxCallControlClientState["phase"]
): TelnyxCallControlClientState {
  return {
    v: 1,
    phase,
    userId: routing.user_id,
    businessLineE164,
    callerE164,
    dialTargetE164,
    ringTimeoutSec,
    fallbackType: routing.fallback_type,
  }
}

async function startVoicemailFlow(
  callControlId: string,
  state: TelnyxCallControlClientState,
  routing: NonNullable<Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>>
): Promise<void> {
  const cfg = await getRoutingConfigForNumber(state.userId, state.businessLineE164).catch(() => null)
  const greeting = resolveVoicemailGreetingText({
    customGreeting: cfg?.ai_greeting,
    organizationName: routing.organization_name,
    phoneLineLabel: routing.phone_line_label,
    businessName: routing.business_name,
  })
  const nextState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_voicemail_prompt_end",
  })
  const speakRes = await telnyxCallControlSpeak(callControlId, greeting, nextState)
  if (!speakRes.ok) {
    console.error(JSON.stringify({ zing: "telnyx-cc-voicemail-speak-failed", error: speakRes.error }))
    await telnyxCallControlHangup(callControlId)
  }
}

/**
 * Play US ringback on the answered inbound A-leg while the cell B-leg rings.
 * Call Control Dial has no TeXML `ringTone` — without this the caller hears silence.
 */
async function startCallerDialRingback(
  inboundCallControlId: string,
  clientState: string
): Promise<void> {
  // Prefer inline WAV so Telnyx does not fetch lyncr.app during Dial setup.
  const playbackContent = loadUsRingbackPlaybackContentBase64()
  // Optional hosted override, else our bundled public asset URL.
  const audioUrl =
    readInboundDialRingbackAudioUrl() || `${getAppUrl()}/audio/us-ringback.wav`
  // Start looping ringback on the caller leg (stop any leftover speak residual).
  const playRes = await telnyxCallControlPlaybackStart(inboundCallControlId, {
    ...(playbackContent
      ? { playbackContent }
      : { audioUrl }),
    clientState,
    loop: "infinity",
    stop: "current",
  })
  if (!playRes.ok) {
    // Dial still proceeds — log so silence-during-ring is diagnosable.
    console.warn(
      lyncrLog("telnyx-cc-dial-ringback-failed", {
        callControlId: inboundCallControlId,
        error: playRes.error,
        usedPlaybackContent: Boolean(playbackContent),
      })
    )
  } else {
    console.log(
      lyncrLog("telnyx-cc-dial-ringback-started", {
        callControlId: inboundCallControlId,
        usedPlaybackContent: Boolean(playbackContent),
      })
    )
  }
}

/** Stop A-leg ringback before bridge / voicemail / hangup (best-effort). */
async function stopCallerDialRingback(inboundCallControlId: string): Promise<void> {
  const id = inboundCallControlId.trim()
  if (!id) return
  await telnyxCallControlPlaybackStop(id).catch(() => undefined)
}

async function dialTechnicianLeg(
  inboundCallControlId: string,
  state: TelnyxCallControlClientState,
  routing: NonNullable<Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>>
): Promise<void> {
  // TODO(cc-sip-browser): When receptionist endpoint=WEB + sip_username, Dial `sip:user@domain`
  // via telnyxCallControlDial (Telnyx `to` accepts SIP URIs) and fall back to PSTN on failure.
  // TeXML already does this in buildFastReceptionistDialWebRtcTexml — CC production is PSTN-only
  // until that lands. Portal honesty uses browser_inbound_live=false while CC is enabled.
  const target = state.dialTargetE164?.trim() || ""
  if (!isReasonablePstnDialString(target)) {
    console.error(JSON.stringify({ zing: "telnyx-cc-dial-missing-target", inboundCallControlId }))
    await telnyxCallControlHangup(inboundCallControlId)
    return
  }
  const businessFrom = resolveInboundOutboundCallerId(routing, state.businessLineE164)
  const dialFrom = isReasonablePstnDialString(businessFrom) ? businessFrom : state.businessLineE164
  let connectionId = ""
  try {
    connectionId = await getOrCreateCallControlApp()
  } catch (e) {
    console.error("[telnyx-cc] Call Control app lookup failed:", e)
    await telnyxCallControlHangup(inboundCallControlId)
    return
  }

  // Hold / AI / company VM: do NOT auto-bridge into personal cell carrier voicemail.
  // Telnyx treats carrier VM as "answered", so no-answer hangup never runs without AMD.
  const fallbackRaw = String(state.fallbackType ?? routing.fallback_type ?? "").toLowerCase()
  const useAmdGuard = fallbackNeedsCarrierVmGuard(fallbackRaw)
  // Stamp dial start so AMD early-false-positive guards + hangup logs can measure ring age.
  const dialStartedAtMs = Date.now()

  const nextStatePayload: TelnyxCallControlClientState = {
    ...state,
    phase: "await_dial_end",
    inboundCallControlId,
    amdGuard: useAmdGuard || undefined,
    dialStartedAtMs,
  }
  const nextState = encodeTelnyxCallControlState(nextStatePayload)
  // Answered A-leg gets silence unless we inject ringback while B-leg rings.
  await startCallerDialRingback(inboundCallControlId, nextState)
  const dialRes = await telnyxCallControlDial({
    connectionId,
    inboundCallControlId,
    toE164: target,
    fromE164: dialFrom,
    timeoutSecs: state.ringTimeoutSec ?? 30,
    clientState: nextState,
    // AMD path: wait for human/machine webhook before bridging.
    bridgeOnAnswer: !useAmdGuard,
    ...(useAmdGuard
      ? {
          answeringMachineDetection: "detect",
          // Longer silence window — default Telnyx 3.5s silence→machine was killing rings early.
          answeringMachineDetectionConfig: buildHoldFallbackAmdDetectionConfig(),
        }
      : {}),
  })
  if (!dialRes.ok) {
    console.error(JSON.stringify({ zing: "telnyx-cc-dial-failed", error: dialRes.error, to: target, from: dialFrom }))
    if (isTelnyxAuthFailureMessage(dialRes.error)) {
      console.error(
        "[telnyx-cc] CRITICAL: TELNYX_API_KEY auth failure on Dial — update the key in Vercel and redeploy."
      )
    }
    await stopCallerDialRingback(inboundCallControlId)
    await telnyxCallControlHangup(inboundCallControlId)
    return
  }

  const outboundCallControlId = dialRes.callControlId?.trim() || ""
  console.log(
    lyncrLog("telnyx-cc-dial-started", {
      inboundCallControlId,
      outboundCallControlId: outboundCallControlId || null,
      toTail4: target.replace(/\D/g, "").slice(-4),
      fromTail4: dialFrom.replace(/\D/g, "").slice(-4),
      // Honest dial plan for ops: timeout + whether AMD is guarding carrier VM.
      timeoutSecs: state.ringTimeoutSec ?? 30,
      dialStartedAtMs,
      amdGuard: useAmdGuard,
      bridgeOnAnswer: !useAmdGuard,
      fallbackType: fallbackRaw || null,
      amdMinMachineAgeMs: useAmdGuard
        ? resolveAmdMinMachineAgeForRingSec(state.ringTimeoutSec ?? 20)
        : null,
    })
  )

  // Track the cell leg so call.hangup on the caller can kill phantom ringing immediately.
  if (outboundCallControlId) {
    await rememberOutboundDialLeg(inboundCallControlId, outboundCallControlId)
    const stateWithOutbound: TelnyxCallControlClientState = {
      ...nextStatePayload,
      outboundCallControlId,
    }
    const encodedWithOutbound = encodeTelnyxCallControlState(stateWithOutbound)
    // Await inbound stamp — hangup webhooks must see outboundCallControlId when possible.
    const inboundRes = await telnyxCallControlClientStateUpdate(inboundCallControlId, encodedWithOutbound)
    if (!inboundRes.ok) {
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-inbound-client-state-update-failed",
          inboundCallControlId,
          error: inboundRes.error,
        })
      )
    }
    void telnyxCallControlClientStateUpdate(outboundCallControlId, encodedWithOutbound).then((outboundRes) => {
      if (!outboundRes.ok) {
        console.warn(
          JSON.stringify({
            zing: "telnyx-cc-outbound-client-state-update-failed",
            outboundCallControlId,
            error: outboundRes.error,
          })
        )
      }
    })
  }
}

async function handleCallInitiated(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const callControlId = event.callControlId
  console.log("Inbound call initiated event received for ID:", callControlId)
  console.log(
    JSON.stringify({
      zing: "telnyx-cc-initiated-start",
      callControlId,
      direction: event.direction || "(empty)",
      from: event.from,
      to: event.to,
    })
  )

  try {
    // Only skip clearly outbound legs. Empty / unknown / "incoming" must proceed to Answer.
    if (isClearlyOutboundDirection(event.direction)) {
      console.log(
        JSON.stringify({
          zing: "telnyx-cc-initiated-skip-outbound",
          callControlId,
          direction: event.direction,
        })
      )
      return
    }
    if (event.direction && !isInboundDirection(event.direction)) {
      // Unknown non-empty direction — log and CONTINUE (do not silent-exit).
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-initiated-unknown-direction-continuing",
          callControlId,
          direction: event.direction,
        })
      )
    }

    const businessLineE164 = normalizePhoneNumberE164(event.to) || event.to
    const callerE164 = event.from.trim() ? normalizePhoneNumberE164(event.from) : "Unknown"
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-initiated-normalized",
        callControlId,
        businessLineE164,
        callerE164,
      })
    )

    // Provisional Answer state — Dial target is refined after routing resolves (and again on call.answered).
    const provisionalRouting = buildFailsafeRouting({
      userId: "00000000-0000-0000-0000-000000000000",
      businessLineE164,
      ownerPhone: FAILSAFE_PRIMARY_CELL_E164,
    })
    const provisionalAnswerState = encodeTelnyxCallControlState(
      baseState(
        provisionalRouting,
        businessLineE164,
        callerE164,
        FAILSAFE_PRIMARY_CELL_E164,
        30,
        "await_caller_answered"
      )
    )

    console.log("Triggering Telnyx Answer API (concurrent with routing)...", { callControlId })
    const answerPromise = telnyxCallControlAnswer(callControlId, provisionalAnswerState)
    const routingPromise = resolveCallControlRouting(event.to)

    const [answerRes, routingResult] = await Promise.all([answerPromise, routingPromise])

    // Graceful fallback when DB has no row for this DID.
    let routing = routingResult
    if (!routing) {
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-no-routing-failsafe",
          to: event.to,
          failsafe: FAILSAFE_PRIMARY_CELL_E164,
        })
      )
      routing = buildFailsafeRouting({
        userId: "00000000-0000-0000-0000-000000000000",
        businessLineE164,
        ownerPhone: FAILSAFE_PRIMARY_CELL_E164,
      })
    }

    console.log("Resolved routing profile:", {
      userId: routing.user_id,
      ownerPhoneTail4: String(routing.owner_phone || "")
        .replace(/\D/g, "")
        .slice(-4),
      organizationName: routing.organization_name,
      accountStatus: routing.account_status,
      fallbackType: routing.fallback_type,
      ringTimeoutSeconds: routing.ring_timeout_seconds,
    })

    const accountStatus = parseAccountStatus(routing.account_status)
    if (accountStatus && isAccountRoutingBlocked(accountStatus)) {
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-initiated-account-blocked",
          callControlId,
          accountStatus,
        })
      )
      // Suspended lines hang up — intentional, not a silent no-op.
      await telnyxCallControlHangup(callControlId)
      return
    }

    // Pass callControlId so the new ringing inbound is not counted as “already on a call”.
    let dialPlan = await resolveCallControlInboundDialPlan(routing, businessLineE164, callControlId)
    let dialTargetE164 = dialPlan.dialTargetE164
    // Only fall back to the owner failsafe when the plan intended a PSTN ring (Available).
    if (dialPlan.reason !== "busy_automation" && !isReasonablePstnDialString(dialTargetE164 || "")) {
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-initiated-empty-dial-target-using-failsafe",
          callControlId,
          failsafe: FAILSAFE_PRIMARY_CELL_E164,
          planReason: dialPlan.reason,
        })
      )
      dialTargetE164 = FAILSAFE_PRIMARY_CELL_E164
      dialPlan = {
        ...dialPlan,
        dialTargetE164,
        routedToName: dialPlan.routedToName || "Owner",
        reason: "failsafe",
      }
    }

    const wantsAi = String(routing.fallback_type ?? "").toLowerCase() === "ai"
    const wantsHold =
      String(routing.fallback_type ?? "").toLowerCase() === "hold" ||
      String(routing.fallback_type ?? "").toLowerCase() === "hold_queue"
    const ringTimeoutSec = resolveInboundForwardDialTimeoutSeconds(
      Number(routing.ring_timeout_seconds ?? 30) || 30,
      wantsAi,
      wantsHold
    )

    console.log(
      JSON.stringify({
        zing: "telnyx-cc-initiated-dial-plan",
        callControlId,
        dialTargetTail4: dialTargetE164
          ? dialTargetE164.replace(/\D/g, "").slice(-4)
          : null,
        ringTimeoutSec,
        planReason: dialPlan.reason,
        recvId: dialPlan.receptionistId,
      })
    )

    // Fire-and-forget call log — never block Answer / dial-plan updates.
    // Busy automation: never mark as "ringing" (that opens owner Incoming Call / New Intake).
    if (routing.user_id && routing.user_id !== "00000000-0000-0000-0000-000000000000") {
      const isBusyAutomation = dialPlan.reason === "busy_automation"
      const ownerUserId = routing.user_id
      void insertCallLog({
        user_id: ownerUserId,
        provider_call_sid: callControlId,
        from_number: callerE164,
        to_number: businessLineE164,
        caller_name: null,
        call_type: "incoming",
        status: isBusyAutomation ? "in-progress" : "ringing",
        duration_seconds: 0,
        routed_to_receptionist_id: dialPlan.receptionistId,
        routed_to_name: dialPlan.routedToName,
        has_recording: false,
        recording_url: null,
        recording_duration_seconds: null,
      })
        .then(async (callLogId) => {
          console.log(JSON.stringify({ zing: "telnyx-cc-initiated-call-log-ok", callControlId }))
          // Still notify the dashboard (toast / Lines) — client suppresses the RINGING sheet.
          if (isBusyAutomation) {
            try {
              const { broadcastCallInitiated } = await import("@/lib/call-telemetry-realtime")
              await broadcastCallInitiated({
                ownerUserId,
                callSid: callControlId,
                callLogId,
                fromNumber: callerE164,
                toNumber: businessLineE164,
                routedToReceptionistId: dialPlan.receptionistId,
                routedToName: dialPlan.routedToName,
                dialReason: "busy_automation",
              })
            } catch (e) {
              console.warn("[telnyx-cc] busy call-initiated broadcast failed:", e)
            }
          }
        })
        .catch((e) => console.error("[telnyx-cc] call log insert failed:", e))
    } else {
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-initiated-skip-call-log-no-user",
          callControlId,
        })
      )
    }

    // Do NOT fire a late client_state_update here. call.answered already re-resolves
    // routing + dial target. A fire-and-forget refine to `await_caller_answered` races
    // with speak's `await_greeting_end` and leaves callers in greeting→silence (no Dial).
    if (answerRes.ok) {
      console.log(
        JSON.stringify({
          zing: "telnyx-cc-answer-ok",
          callControlId,
          dialTargetTail4: dialTargetE164
            ? dialTargetE164.replace(/\D/g, "").slice(-4)
            : null,
          ringTimeoutSec,
          userId: routing.user_id,
          planReason: dialPlan.reason,
        })
      )
      return
    }

    console.error(JSON.stringify({ zing: "telnyx-cc-answer-failed", error: answerRes.error }))
    if (isTelnyxAuthFailureMessage(answerRes.error)) {
      console.error(
        "[telnyx-cc] CRITICAL: TELNYX_API_KEY on Vercel is invalid or revoked. " +
          "Call Control Answer/Dial cannot succeed until you paste a fresh API key " +
          `(failed key prefix: ${String(process.env.TELNYX_API_KEY || "").slice(0, 12)}…). ` +
          "Update Vercel → Environment Variables → TELNYX_API_KEY, then redeploy."
      )
    }

    // Best-effort: try dialing the planned target even if answer payload failed oddly.
    // Never Dial the owner while Presence Busy with no teammate (busy_automation).
    if (dialPlan.reason === "busy_automation" || !isReasonablePstnDialString(dialTargetE164 || "")) {
      console.log(
        JSON.stringify({
          zing: "telnyx-cc-initiated-skip-failsafe-dial-busy",
          callControlId,
          planReason: dialPlan.reason,
        })
      )
      return
    }
    console.log("Triggering Telnyx failsafe Dial after Answer failure...", {
      callControlId,
      to: dialTargetE164,
    })
    try {
      await dialTechnicianLeg(
        callControlId,
        {
          v: 1,
          phase: "await_dial_end",
          userId: routing.user_id,
          businessLineE164,
          callerE164,
          dialTargetE164: dialTargetE164!,
          ringTimeoutSec,
          fallbackType: routing.fallback_type,
          inboundCallControlId: callControlId,
          dialReason: dialPlan.reason,
          receptionistId: dialPlan.receptionistId || undefined,
        },
        routing
      )
    } catch (dialErr) {
      console.error("Telnyx call.initiated failsafe dial failed:", dialErr)
    }
  } catch (error) {
    console.error("Telnyx call.initiated handler failed:", error)
    // Never rethrow — route must return 200 so Telnyx does not hammer retries.
    try {
      const target = FAILSAFE_PRIMARY_CELL_E164
      const businessLineE164 = normalizePhoneNumberE164(event.to) || event.to
      const callerE164 = event.from.trim() ? normalizePhoneNumberE164(event.from) : "Unknown"
      const failsafe = buildFailsafeRouting({
        userId: "00000000-0000-0000-0000-000000000000",
        businessLineE164,
        ownerPhone: target,
      })
      console.log("Triggering Telnyx Answer API (ultimate failsafe)...", { callControlId })
      const answerState = encodeTelnyxCallControlState(
        baseState(failsafe, businessLineE164, callerE164, target, 30, "await_caller_answered")
      )
      const answerRes = await telnyxCallControlAnswer(callControlId, answerState)
      if (!answerRes.ok) {
        console.error(
          JSON.stringify({
            zing: "telnyx-cc-ultimate-failsafe-answer-failed",
            error: answerRes.error,
          })
        )
        if (isTelnyxAuthFailureMessage(answerRes.error)) {
          console.error(
            "[telnyx-cc] CRITICAL: TELNYX_API_KEY auth failure during ultimate failsafe Answer."
          )
        }
      }
    } catch (failsafeErr) {
      console.error("Telnyx call.initiated ultimate failsafe failed:", failsafeErr)
    }
  }
}

async function handleCallAnswered(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  // Lines Answer — agent cell picked up → bridge into the hold queue.
  if (state?.phase === "await_queue_agent_answer") {
    await bridgeAgentToHoldQueue({
      agentCallControlId: event.callControlId,
      state,
    })
    return
  }
  if (!state || state.phase !== "await_caller_answered") return
  // Telnyx often omits direction on call.answered; rely on client_state phase instead.
  if (event.direction && !isInboundDirection(event.direction)) return

  let routing = await resolveCallControlRouting(state.businessLineE164)
  if (!routing) {
    routing = buildFailsafeRouting({
      userId: state.userId || "00000000-0000-0000-0000-000000000000",
      businessLineE164: state.businessLineE164,
      ownerPhone: state.dialTargetE164 || FAILSAFE_PRIMARY_CELL_E164,
    })
  }

  // Presence only depends on routing.user_id, which is already known — start it alongside
  // the dial-plan lookup instead of after it, so the branded greeting (below) isn't waiting
  // through two DB round-trips in series before the caller hears anything. A lookup failure
  // must not break dial-plan resolution, so it is swallowed here exactly like the try/catch
  // around its use below used to.
  const presencePromise = getAccountPresence(routing.user_id).catch(() => null)

  // Re-resolve presence + Who Answers (do not trust provisional Answer client_state target).
  const dialPlan = await resolveCallControlInboundDialPlan(
    routing,
    state.businessLineE164,
    event.callControlId
  )
  let dialTargetE164 = dialPlan.dialTargetE164
  if (dialPlan.reason !== "busy_automation" && !isReasonablePstnDialString(dialTargetE164 || "")) {
    dialTargetE164 = state.dialTargetE164?.trim() || FAILSAFE_PRIMARY_CELL_E164
  }
  const wantsAi = String(routing.fallback_type ?? state.fallbackType ?? "").toLowerCase() === "ai"
  const wantsHold =
    String(routing.fallback_type ?? state.fallbackType ?? "").toLowerCase() === "hold" ||
    String(routing.fallback_type ?? state.fallbackType ?? "").toLowerCase() === "hold_queue"
  const ringTimeoutSec = resolveInboundForwardDialTimeoutSeconds(
    Number(routing.ring_timeout_seconds ?? state.ringTimeoutSec ?? 30) || 30,
    wantsAi,
    wantsHold
  )
  const enrichedState: TelnyxCallControlClientState = {
    ...state,
    userId: routing.user_id || state.userId,
    dialTargetE164: dialTargetE164 || undefined,
    ringTimeoutSec,
    fallbackType: routing.fallback_type ?? state.fallbackType,
    dialReason: dialPlan.reason,
    receptionistId: dialPlan.receptionistId || undefined,
  }

  const greetingEnabled = isInboundCallerGreetingEnabled(routing)
  // Skip branded greeting when Busy menu answers first — avoids double greetings.
  if (greetingEnabled && dialPlan.reason !== "busy_automation") {
    const workspaceName = resolveWorkspaceDisplayName(routing)
    const greetingText = buildInboundCallerGreetingText(workspaceName)
    // Short connect greets must be reliable — ElevenLabs often HTTP-200 then speak.failed.
    // Prefer NaturalHD up front so callers hear "Connecting you now" (persona still maps gender).
    let greetVoice = "Telnyx.NaturalHD.astra"
    const presence = await presencePromise
    if (presence) {
      const personaVoice = preferWorkingSpeakVoice(
        resolveSpeakVoiceForPersona(presence.ivrVoiceEngineModel) || greetVoice
      )
      // Remap flaky ElevenLabs → NaturalHD for this short phrase (Busy gather keeps persona retry).
      greetVoice = /^ElevenLabs\./i.test(personaVoice)
        ? elevenLabsNaturalHdFallback(personaVoice)
        : personaVoice
    }
    if (!greetVoice) greetVoice = "Telnyx.NaturalHD.astra"
    const nextState = encodeTelnyxCallControlState({
      ...enrichedState,
      phase: "await_greeting_end",
      // Snapshot so speak.failed knows which engine died (opens ElevenLabs circuit).
      holdSpeakVoice: greetVoice,
      dialReason: dialPlan.reason,
    })
    const speakRes = await telnyxCallControlSpeak(
      event.callControlId,
      greetingText,
      nextState,
      { voice: greetVoice }
    )
    if (!speakRes.ok) {
      console.error(JSON.stringify({ zing: "telnyx-cc-greeting-speak-failed", error: speakRes.error }))
      // No "busy_automation" test here: the earlier guard already returned for that reason,
      // so by this point it is not reachable. Only the missing-dial-target case remains.
      if (!isReasonablePstnDialString(dialTargetE164 || "")) {
        await startBusyAutomationFlow(event.callControlId, enrichedState, routing)
      } else {
        // Speak HTTP failed — still Dial with US ringback (never dead air).
        await dialTechnicianLeg(event.callControlId, enrichedState, routing)
      }
    }
    return
  }

  if (dialPlan.reason === "busy_automation" || !isReasonablePstnDialString(dialTargetE164 || "")) {
    await startBusyAutomationFlow(event.callControlId, enrichedState, routing)
    return
  }

  await dialTechnicianLeg(event.callControlId, enrichedState, routing)
}

async function handleSpeakEnded(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state) return

  // Booking SMS confirmation finished — hang up.
  if (state.phase === "await_busy_sms_confirm_end") {
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-busy-sms-confirm-hangup",
        callControlId: event.callControlId,
      })
    )
    await telnyxCallControlHangup(event.callControlId)
    return
  }

  // Legacy busy speak hangup (pre-gather) — keep safe if old client_state is in flight.
  if (state.dialReason === "busy_automation" && state.phase === "await_voicemail_prompt_end") {
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-busy-automation-hangup",
        callControlId: event.callControlId,
      })
    )
    await telnyxCallControlHangup(event.callControlId)
    return
  }

  // `await_greeting_end` is the happy path. Also dial when phase is still
  // `await_caller_answered` — a late client_state refine can overwrite speak's
  // greeting phase (production: greeting plays, speak.ended ignored, cell never rings).
  const shouldDialAfterGreeting =
    state.phase === "await_greeting_end" || state.phase === "await_caller_answered"

  if (shouldDialAfterGreeting) {
    if (state.phase === "await_caller_answered") {
      console.warn(
        JSON.stringify({
          zing: "telnyx-cc-speak-ended-stale-phase-recover-dial",
          callControlId: event.callControlId,
          phase: state.phase,
          dialTargetTail4: String(state.dialTargetE164 || "")
            .replace(/\D/g, "")
            .slice(-4) || null,
        })
      )
    }
    await continueAfterInboundGreeting(event, state)
    return
  }

  if (state.phase === "await_voicemail_prompt_end") {
    const appUrl = getAppUrl()
    const recordWebhook = `${appUrl}/api/voice/telnyx/recording-status`
    const nextState = encodeTelnyxCallControlState({ ...state, phase: "recording" })
    const recordRes = await telnyxCallControlRecordStart(event.callControlId, nextState, recordWebhook)
    if (!recordRes.ok) {
      console.error(JSON.stringify({ zing: "telnyx-cc-record-start-failed", error: recordRes.error }))
      await telnyxCallControlHangup(event.callControlId)
    }
  }
}

async function handleGatherEnded(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state) return

  // Soft hold / queue re-prompt loop (music ↔ Busy message).
  if (state.phase === "await_busy_hold_loop") {
    await handleHoldLoopGatherEnded({
      callControlId: event.callControlId,
      state,
      digits: event.digits.replace(/\D/g, ""),
      gatherStatus: event.gatherStatus,
    })
    return
  }

  if (state.phase !== "await_busy_gather_end") return

  const digits = event.digits.replace(/\D/g, "")
  const gatherStatus = event.gatherStatus
  const gatherEndedAtMs = Date.now()
  console.log(
    lyncrLog("telnyx-cc-busy-gather-ended", {
      callControlId: event.callControlId,
      digits: digits || null,
      gatherStatus: gatherStatus || null,
    })
  )

  // Caller hung up during Busy menu — do NOT enter hold / play music on a dead call.
  // Production logs showed call_hangup → enqueue/playback 422 "no longer active" → silent spam.
  // Always clear the Lines preview row (same as hold-loop hangup) so “Can't answer yet” cannot stick.
  if (
    gatherStatus === "call_hangup" ||
    gatherStatus === "cancelled" ||
    gatherStatus === "call_hangup_bye"
  ) {
    console.log(
      lyncrLog("telnyx-cc-busy-gather-caller-left", {
        callControlId: event.callControlId,
        gatherStatus,
      })
    )
    await abandonHoldQueue(event.callControlId).catch(() => undefined)
    return
  }

  // ElevenLabs speak.failed → gatherStatus=invalid in ~1s with no audio.
  // Retry the Busy greeting once with NaturalHD before hold music (priority: greeting must play).
  if (!digits && gatherStatus === "invalid" && !state.busySpeakFallbackTried) {
    const priorVoice = String(state.holdSpeakVoice || "")
    if (/^ElevenLabs\./i.test(priorVoice)) {
      markElevenLabsSpeakFailed("busy_gather_invalid")
      const fbVoice = elevenLabsNaturalHdFallback(priorVoice)
      console.warn(
        lyncrLog("telnyx-cc-busy-gather-elevenlabs-invalid-retry", {
          callControlId: event.callControlId,
          priorVoice,
          fallback: fbVoice,
        })
      )
      const routingForRetry = await resolveCallControlRouting(state.businessLineE164)
      if (routingForRetry) {
        await startBusyAutomationFlow(event.callControlId, {
          ...state,
          holdSpeakVoice: fbVoice,
          busySpeakFallbackTried: true,
        }, routingForRetry)
        return
      }
      // No routing — still try NaturalHD gather with the last known prompt path.
      await startBusyAutomationFlow(
        event.callControlId,
        { ...state, holdSpeakVoice: fbVoice, busySpeakFallbackTried: true },
        buildFailsafeRouting({
          userId: state.userId || "00000000-0000-0000-0000-000000000000",
          businessLineE164: state.businessLineE164,
          ownerPhone: FAILSAFE_PRIMARY_CELL_E164,
        })
      )
      return
    }
  }

  // Stay-on-line / timeout: kick hold music in parallel with routing DB (target <1–2s audible).
  // If after-hours later wins, we stop playback.
  const musicKickPromise = !digits
    ? kickHoldMusicPlaybackImmediate({
        callControlId: event.callControlId,
        state,
        gatherEndedAtMs,
      })
    : Promise.resolve(false)

  const routingPromise = resolveCallControlRouting(state.businessLineE164)

  const [musicKicked, routingResolved] = await Promise.all([musicKickPromise, routingPromise])
  let routing = routingResolved
  if (!routing) {
    routing = buildFailsafeRouting({
      userId: state.userId || "00000000-0000-0000-0000-000000000000",
      businessLineE164: state.businessLineE164,
      ownerPhone: FAILSAFE_PRIMARY_CELL_E164,
    })
  }

  // One presence fetch covers bypass + after-hours (was two sequential awaits).
  let bypassMatch = false
  let skipHoldForAfterHours = false
  try {
    const presence = await getAccountPresence(routing.user_id)
    bypassMatch = digitsMatchIvrBypass(digits, presence.ivrBypassCode)
    const holidayActive = Boolean(
      resolveHolidayGreetingText({
        holidayOverrideStart: presence.holidayOverrideStart,
        holidayOverrideEnd: presence.holidayOverrideEnd,
        holidayGreetingText: presence.holidayGreetingText,
      })
    )
    const status = String(presence.presenceStatus || "")
      .trim()
      .toUpperCase()
    skipHoldForAfterHours = holidayActive || status === "CLOSED"
  } catch (e) {
    console.warn("[telnyx-cc] presence lookup skipped:", e)
  }

  // Secret bypass or press 2 → ring owner cell (matches TeXML menu / open IVR).
  if (digits === "2" || bypassMatch) {
    if (musicKicked) {
      await telnyxCallControlPlaybackStop(event.callControlId).catch(() => undefined)
    }
    const owner =
      normalizePhoneNumberE164(routing.owner_phone || "") ||
      (isReasonablePstnDialString(routing.owner_phone || "")
        ? String(routing.owner_phone).trim()
        : FAILSAFE_PRIMARY_CELL_E164)
    const dialState: TelnyxCallControlClientState = {
      ...state,
      dialTargetE164: owner,
      dialReason: "day_dial",
      receptionistId: undefined,
    }
    console.log(
      lyncrLog("telnyx-cc-busy-gather-press2-or-bypass", {
        callControlId: event.callControlId,
        bypassMatch,
        ownerTail4: owner.replace(/\D/g, "").slice(-4),
      })
    )
    await dialTechnicianLeg(event.callControlId, dialState, routing)
    return
  }

  // Press 1 → booking SMS + hangup (Activity: Booked from hold · press 1).
  if (digits === "1") {
    if (musicKicked) {
      await telnyxCallControlPlaybackStop(event.callControlId).catch(() => undefined)
    }
    void updateCallQueueStatus({
      callControlId: event.callControlId,
      status: "sms_left",
    })
    await sendInboundBookingSmsAndTag({
      fromE164: state.callerE164,
      ownerUserId: routing.user_id,
      businessLineE164: state.businessLineE164,
      callSid: event.callControlId,
      routedToName: CAPTURE_STATUS_HOLD_PRESS1,
      source: "cc_busy_press1",
      businessLabel: resolveWorkspaceDisplayName(routing),
    })
    await confirmBusySmsAndHangup(event.callControlId, state)
    return
  }

  // After-hours (CLOSED) or holiday → straight to form SMS (nobody will Answer from Lines).
  if (skipHoldForAfterHours) {
    if (musicKicked) {
      await telnyxCallControlPlaybackStop(event.callControlId).catch(() => undefined)
    }
    console.log(
      lyncrLog("telnyx-cc-busy-gather-after-hours-sms", {
        callControlId: event.callControlId,
      })
    )
    await sendInboundBookingSmsAndTag({
      fromE164: state.callerE164,
      ownerUserId: routing.user_id,
      businessLineE164: state.businessLineE164,
      callSid: event.callControlId,
      routedToName: CAPTURE_STATUS_HOLD_PRESS1,
      source: "cc_busy_after_hours",
      businessLabel: resolveWorkspaceDisplayName(routing),
    })
    await confirmBusySmsAndHangup(event.callControlId, state)
    return
  }

  // Timeout / stay on the line → hold music + Neon queue (NOT immediate SMS+hangup).
  await enterBusyHoldQueue({
    callControlId: event.callControlId,
    state,
    routing,
    callSessionId: event.callSessionId,
    gatherEndedAtMs,
    musicAlreadyStarted: musicKicked,
  })
}

async function handleCallBridged(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state) return
  // Bridge events usually arrive on the outbound PSTN leg — still map back to the inbound call log row.
  const inboundSid = resolveInboundCallLogSid(event)
  // Cell answered — stop A-leg ringback so talk audio is not mixed with tone.
  const inboundForAudio =
    state.inboundCallControlId?.trim() ||
    (!isOutboundDialLegEvent(event) ? event.callControlId : "") ||
    inboundSid
  if (inboundForAudio) {
    await stopCallerDialRingback(inboundForAudio)
  }
  await persistCallControlBridged(inboundSid, state, event.occurredAt)
}

/**
 * After cell miss (ring timeout) OR AMD machine / carrier voicemail — run Advanced Rules fallback.
 * Shared by call.hangup (no_answer) and call.machine.detection.ended (machine).
 */
async function applyDialMissFallback(params: {
  inboundCallControlId: string
  state: TelnyxCallControlClientState
  reason: "no_answer" | "amd_machine"
}): Promise<void> {
  const { inboundCallControlId, state, reason } = params
  const routing = await getIncomingRoutingForVoiceWebhook(state.businessLineE164)
  if (!routing) {
    await telnyxCallControlHangup(inboundCallControlId)
    return
  }

  // Busy backup teammate missed — do not Dial the Busy owner; play automation instead.
  if (state.dialReason === "busy_backup_recv" || state.dialReason === "team_receptionist") {
    const plan = await resolveInboundCapturePlan({ ownerUserId: routing.user_id }).catch(() => null)
    if (!plan || plan.kind !== "day_dial") {
      await startBusyAutomationFlow(inboundCallControlId, state, routing)
      return
    }
    // Owner became Available while teammate rang — fall through to owner voicemail / hangup below.
  }

  const fallback = String(state.fallbackType ?? routing.fallback_type ?? "voicemail").toLowerCase()
  // Advanced Rules → Hold queue: reuse Busy soft-hold (music, press 1, Lines Answer).
  if (fallback === "hold" || fallback === "hold_queue") {
    console.log(
      lyncrLog("telnyx-cc-dial-miss-hold-queue", {
        inboundCallControlId,
        businessLineE164: state.businessLineE164,
        reason,
      })
    )
    await startBusyAutomationFlow(inboundCallControlId, state, routing)
    return
  }
  if (fallback === "voicemail" || fallback === "owner") {
    console.log(
      lyncrLog("telnyx-cc-dial-miss-voicemail", {
        inboundCallControlId,
        reason,
        fallback,
      })
    )
    await startVoicemailFlow(inboundCallControlId, state, routing)
    return
  }

  console.log(
    lyncrLog("telnyx-cc-dial-miss-hangup", {
      inboundCallControlId,
      reason,
      fallback,
    })
  )
  await telnyxCallControlHangup(inboundCallControlId)
}

/**
 * AI Assistant conversation concluded (max-wait hold bridge, `087`) — the leg does not
 * auto-hangup, so send the guaranteed booking-link SMS safety net (same dedupe/cooldown
 * as every other hold outcome) and end the call ourselves.
 */
async function handleAiConversationEnded(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state || state.phase !== "await_ai_assistant_hold") return
  const callControlId = event.callControlId

  console.log(lyncrLog("telnyx-cc-ai-conversation-ended", { callControlId }))

  if (typeof state.aiAssistantStartedAtMs === "number" && state.aiAssistantStartedAtMs > 0) {
    const seconds = Math.max(0, Date.now() - state.aiAssistantStartedAtMs) / 1000
    void reportAiAssistantMinutesUsage(state.userId, seconds, callControlId)
  }

  try {
    await sendInboundBookingSmsAndTag({
      fromE164: state.callerE164,
      ownerUserId: state.userId,
      businessLineE164: state.businessLineE164,
      callSid: callControlId,
      routedToName: CAPTURE_STATUS_HOLD_AI_ASSISTED,
      source: "cc_busy_hold_ai_wrapup",
      tone: "hold_timeout",
    })
  } catch (e) {
    console.warn(lyncrLog("telnyx-cc-ai-wrapup-sms-failed", { callControlId, error: String(e) }))
  }

  await telnyxCallControlHangup(callControlId)
}

/**
 * AMD result on the outbound cell leg.
 * human → bridge caller ↔ cell. machine → hang up B-leg and enter hold / company VM / etc.
 * Telnyx recommends treating not_sure as human.
 *
 * Early `machine` / `silence` (often 2–3s after dial) is usually a false positive on ringback
 * or a quiet human pickup — require a minimum dial age before hanging up into hold.
 */
async function handleMachineDetectionEnded(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state || state.phase !== "await_dial_end") return
  // Only act when this Dial opted into AMD (Hold / AI / company VM fallbacks).
  if (!state.amdGuard) return
  if (!isOutboundDialLegEvent(event)) return

  const inboundCallControlId = state.inboundCallControlId?.trim() || ""
  if (!inboundCallControlId) {
    console.error(
      lyncrLog("telnyx-cc-amd-missing-inbound", { callControlId: event.callControlId })
    )
    return
  }

  const raw = event.amdResult.trim().toLowerCase()
  // How long since we POSTed Dial (ring age) — used to reject early false "machine".
  const dialAgeMs =
    typeof state.dialStartedAtMs === "number" && state.dialStartedAtMs > 0
      ? Math.max(0, Date.now() - state.dialStartedAtMs)
      : null
  // Floor from env + near end of this Dial's ring timeout (full cell ring before Hold).
  const minMachineAgeMs = resolveAmdMinMachineAgeForRingSec(state.ringTimeoutSec ?? 20)

  // Premium AMD uses human_residence / human_business; classic uses human.
  const isHuman =
    raw === "human" ||
    raw === "human_residence" ||
    raw === "human_business" ||
    raw === "not_sure" ||
    raw === ""
  // Do not treat bare `silence` as machine — ambiguous and often fires during ring/early media.
  const looksLikeMachine = raw === "machine" || raw === "fax_detected"
  // Only trust machine near the end of the configured ring window (default ~18s / ring−3s).
  // Missing dialStartedAtMs → do not trust (prefer bridge over a 3s hangup).
  const machineTrusted =
    looksLikeMachine && dialAgeMs != null && dialAgeMs >= minMachineAgeMs
  // Early machine → treat as human and bridge (carrier VM almost never answers mid-ring).
  const earlyMachineAsHuman = looksLikeMachine && !machineTrusted

  console.log(
    lyncrLog("telnyx-cc-dial-amd-result", {
      outboundCallControlId: event.callControlId,
      inboundCallControlId,
      amdResult: raw || null,
      dialAgeMs,
      minMachineAgeMs,
      classified: machineTrusted
        ? "machine"
        : isHuman || earlyMachineAsHuman
          ? earlyMachineAsHuman
            ? "early_machine_as_human"
            : "human"
          : "unknown",
      fallbackType: state.fallbackType ?? null,
    })
  )

  if (machineTrusted) {
    // Carrier / answering machine — hang up B-leg before the caller hears personal VM.
    await forgetOutboundDialLeg(inboundCallControlId)
    await stopCallerDialRingback(inboundCallControlId)
    const hangupRes = await telnyxCallControlHangup(event.callControlId)
    if (!hangupRes.ok) {
      console.warn(
        lyncrLog("telnyx-cc-amd-machine-hangup-failed", {
          outboundCallControlId: event.callControlId,
          error: hangupRes.error,
        })
      )
    }
    console.log(
      lyncrLog("telnyx-cc-dial-amd-machine-to-fallback", {
        inboundCallControlId,
        dialAgeMs,
        fallbackType: state.fallbackType ?? null,
      })
    )
    await applyDialMissFallback({
      inboundCallControlId,
      state,
      reason: "amd_machine",
    })
    return
  }

  // Human, not_sure, silence, or early false machine — bridge A ↔ B.
  await stopCallerDialRingback(inboundCallControlId)
  const bridgeRes = await telnyxCallControlBridge(event.callControlId, {
    callControlId: inboundCallControlId,
    clientState: encodeTelnyxCallControlState(state),
  })
  if (!bridgeRes.ok) {
    console.error(
      lyncrLog("telnyx-cc-amd-human-bridge-failed", {
        outboundCallControlId: event.callControlId,
        inboundCallControlId,
        error: bridgeRes.error,
        earlyMachineAsHuman,
        dialAgeMs,
      })
    )
    // Early false-positive AMD must NOT abort the cell dial into Hold — retry once, then wait.
    if (earlyMachineAsHuman || (dialAgeMs != null && dialAgeMs < minMachineAgeMs)) {
      const retry = await telnyxCallControlBridge(event.callControlId, {
        callControlId: inboundCallControlId,
        clientState: encodeTelnyxCallControlState(state),
      })
      if (retry.ok) {
        console.log(
          lyncrLog("telnyx-cc-dial-amd-bridge-human-retry", {
            outboundCallControlId: event.callControlId,
            inboundCallControlId,
          })
        )
        await persistCallControlBridged(inboundCallControlId, state, event.occurredAt)
        return
      }
      // Leave B-leg ringing / connected — dial timeout or a later hangup owns Hold fallback.
      console.warn(
        lyncrLog("telnyx-cc-amd-early-bridge-skip-hold", {
          outboundCallControlId: event.callControlId,
          inboundCallControlId,
          dialAgeMs,
          minMachineAgeMs,
        })
      )
      return
    }
    // Trusted human path bridge failed — treat like a miss so the caller still reaches hold / VM.
    await forgetOutboundDialLeg(inboundCallControlId)
    await telnyxCallControlHangup(event.callControlId).catch(() => undefined)
    await applyDialMissFallback({
      inboundCallControlId,
      state,
      reason: "amd_machine",
    })
    return
  }

  console.log(
    lyncrLog("telnyx-cc-dial-amd-bridge-human", {
      outboundCallControlId: event.callControlId,
      inboundCallControlId,
      amdResult: raw || "human",
    })
  )
  await persistCallControlBridged(inboundCallControlId, state, event.occurredAt)
}

async function hangupCompanionOutboundLeg(
  inboundCallControlId: string,
  state: TelnyxCallControlClientState | null | undefined,
  callSessionId?: string
): Promise<void> {
  const inbound = inboundCallControlId.trim()
  if (!inbound) return

  let outbound =
    state?.outboundCallControlId?.trim() ||
    (await lookupOutboundDialLeg(inbound)) ||
    ""

  await forgetOutboundDialLeg(inbound)

  // Last resort: hang up every other live leg in this call session (covers stale client_state).
  if ((!outbound || outbound === inbound) && callSessionId?.trim()) {
    try {
      const connectionId = await getOrCreateCallControlApp()
      const active = await telnyxListActiveCalls(connectionId)
      const siblings = active.filter(
        (leg) =>
          leg.callSessionId === callSessionId.trim() &&
          leg.callControlId &&
          leg.callControlId !== inbound
      )
      console.log(
        JSON.stringify({
          zing: "telnyx-cc-hangup-session-siblings",
          inboundCallControlId: inbound,
          callSessionId: callSessionId.trim(),
          siblingCount: siblings.length,
        })
      )
      for (const leg of siblings) {
        const hangupRes = await telnyxCallControlHangup(leg.callControlId)
        if (!hangupRes.ok) {
          console.error(
            JSON.stringify({
              zing: "telnyx-cc-hangup-session-sibling-failed",
              outboundCallControlId: leg.callControlId,
              error: hangupRes.error,
            })
          )
        }
      }
      if (siblings.length > 0) return
    } catch (e) {
      console.error("[telnyx-cc] session sibling hangup failed:", e)
    }
  }

  if (!outbound || outbound === inbound) {
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-hangup-no-outbound-companion",
        inboundCallControlId: inbound,
        hadStateOutbound: Boolean(state?.outboundCallControlId),
        callSessionId: callSessionId || null,
      })
    )
    return
  }

  console.log(
    JSON.stringify({
      zing: "telnyx-cc-hangup-companion-outbound",
      inboundCallControlId: inbound,
      outboundCallControlId: outbound,
    })
  )

  // Await hangup so Vercel does not freeze the lambda before the Telnyx POST completes.
  const hangupRes = await telnyxCallControlHangup(outbound)
  if (!hangupRes.ok) {
    console.error(
      JSON.stringify({
        zing: "telnyx-cc-hangup-companion-failed",
        outboundCallControlId: outbound,
        error: hangupRes.error,
      })
    )
  }
}

async function handleCallHangup(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  const inboundSid = resolveInboundCallLogSid(event)

  console.log(
    JSON.stringify({
      zing: "telnyx-cc-hangup-received",
      callControlId: event.callControlId,
      inboundSid,
      phase: state?.phase ?? null,
      hangupCause: event.hangupCause,
      dialStatus: event.dialStatus || null,
      callDurationSeconds: event.callDurationSeconds || null,
      // Ring age from our Dial POST — ops can compare dial-start → hangup.
      dialAgeMs:
        typeof state?.dialStartedAtMs === "number" && state.dialStartedAtMs > 0
          ? Math.max(0, Date.now() - state.dialStartedAtMs)
          : null,
      ringTimeoutSec: state?.ringTimeoutSec ?? null,
      amdGuard: state?.amdGuard ?? null,
      isOutboundLeg: isOutboundDialLegEvent(event),
      outboundFromState: state?.outboundCallControlId ?? null,
      callSessionId: event.callSessionId || null,
    })
  )

  // Hangup means this call_control_id is terminal — skip later leave_queue/hangup races on this instance.
  markTelnyxCallControlTerminal(event.callControlId)

  if (
    state?.phase === "await_dial_end" &&
    isDialNoAnswerHangup(event) &&
    isOutboundDialLegEvent(event)
  ) {
    const inboundCallControlId = state.inboundCallControlId?.trim() || ""
    if (!inboundCallControlId) {
      console.error(JSON.stringify({ zing: "telnyx-cc-hangup-missing-inbound-leg", callControlId: event.callControlId }))
      return
    }

    await forgetOutboundDialLeg(inboundCallControlId)
    await persistCallControlDialNoAnswer(inboundSid, event)

    // Cell missed — stop ringback before voicemail / Busy menu.
    await stopCallerDialRingback(inboundCallControlId)

    await applyDialMissFallback({
      inboundCallControlId,
      state,
      reason: "no_answer",
    })
    console.log(
      lyncrLog("telnyx-cc-dial-miss-after-hangup", {
        inboundCallControlId,
        hangupCause: event.hangupCause,
        dialStatus: event.dialStatus || null,
        dialAgeMs:
          typeof state.dialStartedAtMs === "number" && state.dialStartedAtMs > 0
            ? Math.max(0, Date.now() - state.dialStartedAtMs)
            : null,
        ringTimeoutSec: state.ringTimeoutSec ?? null,
      })
    )
    return
  }

  // Outbound cell leg ended for another reason (answered then hung up, rejected, etc.).
  if (isOutboundDialLegEvent(event)) {
    const inboundCallControlId = state?.inboundCallControlId?.trim() || inboundSid
    await forgetOutboundDialLeg(inboundCallControlId)
    console.log(
      JSON.stringify({
        zing: "telnyx-cc-hangup-outbound-leg-done",
        callControlId: event.callControlId,
        inboundCallControlId,
      })
    )
    return
  }

  // Caller hung up (inbound leg) — immediately terminate any still-ringing / bridged cell leg.
  // Also covers greeting-phase hangups where client_state is stale but Dial already started.
  await hangupCompanionOutboundLeg(event.callControlId, state, event.callSessionId)

  // Always clear any hold / Busy-menu queue row on inbound hangup — even when
  // client_state is missing/stale (that gap left Key Squad ghost “holding” cards).
  // Hangup without press 1 must NOT trigger Missed Call Rescue / booking SMS.
  await abandonHoldQueue(event.callControlId).catch(() => undefined)
  if (
    state?.phase === "await_busy_hold_loop" ||
    state?.holdQueueName ||
    state?.dialReason === "busy_automation" ||
    state?.phase === "await_busy_gather_end"
  ) {
    // Mark IVR “done” so status-callback rescue skips this Busy abandon.
    void markIvrActionCompleted(event.callControlId)
  }

  const hadConversation =
    event.hangupCause === "normal_clearing" &&
    state?.phase !== "recording" &&
    state?.phase !== "await_voicemail_prompt_end" &&
    state?.phase !== "await_busy_gather_end" &&
    state?.phase !== "await_busy_sms_confirm_end" &&
    state?.phase !== "await_busy_hold_loop" &&
    state?.phase !== "await_ai_assistant_hold" &&
    (Boolean(state?.inboundCallControlId) || state?.phase === "await_dial_end")

  await finalizeCallControlCallLog(inboundSid, event, {
    callType: state?.phase === "recording" ? "voicemail" : undefined,
    hadConversation,
  })
}

/** Main Call Control webhook switch — returns after scheduling Telnyx actions. */
export async function handleTelnyxCallControlVoiceWebhook(body: Record<string, unknown>): Promise<void> {
  // Keep hold + ringback WAV base64 warm on this instance (cheap no-op after first load).
  prefetchHoldMusicPlaybackContent()
  prefetchUsRingbackPlaybackContent()

  const event = parseTelnyxVoiceWebhookEvent(body)
  if (!event) {
    console.warn("[telnyx-cc] unparseable voice webhook")
    return
  }

  console.log(
    lyncrLog("telnyx-cc-event", {
      eventType: event.eventType,
      direction: event.direction,
      phase: event.clientState?.phase ?? null,
      callControlId: event.callControlId,
    })
  )

  switch (event.eventType) {
    case "call.initiated":
      try {
        await handleCallInitiated(event)
      } catch (error) {
        // Belt-and-suspenders — handleCallInitiated already swallows errors.
        console.error("Telnyx call.initiated handler failed:", error)
      }
      break
    case "call.answered":
      await handleCallAnswered(event)
      break
    case "call.speak.ended":
      await handleSpeakEnded(event)
      break
    case "call.speak.failed":
      await handleSpeakFailed(event)
      break
    case "call.gather.ended":
      await handleGatherEnded(event)
      break
    case "call.enqueued":
      // Recovery: restart music if enqueue cleared media. Primary start is in enterBusyHoldQueue.
      console.log(
        lyncrLog("telnyx-cc-event-enqueued", {
          callControlId: event.callControlId,
          hasClientState: Boolean(event.clientState),
          phase: event.clientState?.phase ?? null,
        })
      )
      if (event.clientState) {
        await handleCallEnqueuedHoldMusic(event.callControlId, event.clientState)
      }
      break
    case "call.bridged":
      await handleCallBridged(event)
      break
    case "call.machine.detection.ended":
    case "call.machine.premium.detection.ended":
      await handleMachineDetectionEnded(event)
      break
    case "call.hangup":
      await handleCallHangup(event)
      break
    case "call.conversation.ended":
      await handleAiConversationEnded(event)
      break
    default:
      break
  }
}

export function readInboundCallControlEnabled(): boolean {
  // Prefer LYNCR_INBOUND_CALL_CONTROL; still accept legacy ZING_* until Vercel is renamed.
  return envFlagOn("INBOUND_CALL_CONTROL")
}
