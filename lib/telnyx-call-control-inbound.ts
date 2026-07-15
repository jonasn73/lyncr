// Inbound Call Control pipeline: call.initiated → answer → call.answered → speak → speak.ended → dial.

import { getAppUrl } from "@/lib/telnyx"
import {
  telnyxCallControlAnswer,
  telnyxCallControlDial,
  telnyxCallControlHangup,
  telnyxCallControlRecordStart,
  telnyxCallControlSpeak,
} from "@/lib/telnyx-call-control-api"
import { parseTelnyxVoiceWebhookEvent } from "@/lib/telnyx-call-control-parse"
import {
  encodeTelnyxCallControlState,
  type TelnyxCallControlClientState,
} from "@/lib/telnyx-call-control-state"
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
import { resolveInboundForwardDialTimeoutSeconds } from "@/lib/telnyx-inbound-media-quality"
import { resolveInboundOutboundCallerId } from "@/lib/telnyx-pstn-dial-callerid"
import { resolveVoicemailGreetingText } from "@/lib/voicemail-greeting"
import { isAccountRoutingBlocked, parseAccountStatus } from "@/lib/account-status"
import { CAPTURE_DEFAULT_RING_E164 } from "@/lib/inbound-time-capture"
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
  try {
    const routing = await getIncomingRoutingForVoiceWebhook(businessLineE164 || toRaw)
    if (routing) return routing
  } catch (error) {
    console.error("Telnyx call.initiated routing lookup failed:", error)
  }

  // Second chance: phone_numbers row alone (lighter query) → failsafe owner dial.
  try {
    const line = await getActivePhoneNumberByE164(businessLineE164 || toRaw)
    if (line?.user_id) {
      return buildFailsafeRouting({
        userId: line.user_id,
        businessLineE164: line.number || businessLineE164,
        ownerPhone: null,
      })
    }
  } catch (error) {
    console.error("Telnyx call.initiated line lookup failed:", error)
  }

  return null
}

function normalizeDirection(direction: string): string {
  return direction.trim().toLowerCase()
}

function isInboundDirection(direction: string): boolean {
  const d = normalizeDirection(direction)
  return d === "incoming" || d === "inbound"
}

function resolveDialTargetE164(routing: Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>): string {
  if (!routing) return ""
  const recv = routing.receptionist_phone?.trim()
  if (routing.selected_receptionist_id?.trim() && recv) {
    const e164 = normalizePhoneNumberE164(recv)
    if (isReasonablePstnDialString(e164)) return e164
  }
  const owner = routing.owner_phone?.trim()
  if (owner) {
    const e164 = normalizePhoneNumberE164(owner)
    if (isReasonablePstnDialString(e164)) return e164
  }
  return ""
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

async function dialTechnicianLeg(
  inboundCallControlId: string,
  state: TelnyxCallControlClientState,
  routing: NonNullable<Awaited<ReturnType<typeof getIncomingRoutingForVoiceWebhook>>>
): Promise<void> {
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
  const nextState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_dial_end",
    inboundCallControlId,
  })
  const dialRes = await telnyxCallControlDial({
    connectionId,
    inboundCallControlId,
    toE164: target,
    fromE164: dialFrom,
    timeoutSecs: state.ringTimeoutSec ?? 30,
    clientState: nextState,
  })
  if (!dialRes.ok) {
    console.error(JSON.stringify({ zing: "telnyx-cc-dial-failed", error: dialRes.error, to: target, from: dialFrom }))
    await telnyxCallControlHangup(inboundCallControlId)
    return
  }
  console.log(
    JSON.stringify({
      zing: "telnyx-cc-dial-started",
      inboundCallControlId,
      outboundCallControlId: dialRes.callControlId ?? null,
      toTail4: target.replace(/\D/g, "").slice(-4),
      fromTail4: dialFrom.replace(/\D/g, "").slice(-4),
    })
  )
}

async function handleCallInitiated(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  try {
    if (!isInboundDirection(event.direction)) return

    const businessLineE164 = normalizePhoneNumberE164(event.to)
    const callerE164 = event.from.trim() ? normalizePhoneNumberE164(event.from) : "Unknown"

    let routing = await resolveCallControlRouting(event.to)
    // Absolute last resort — still answer + dial primary cell even with no DB row.
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
        businessLineE164: businessLineE164 || event.to,
        ownerPhone: FAILSAFE_PRIMARY_CELL_E164,
      })
    }

    const accountStatus = parseAccountStatus(routing.account_status)
    if (accountStatus && isAccountRoutingBlocked(accountStatus)) {
      await telnyxCallControlHangup(event.callControlId)
      return
    }

    let dialTargetE164 = resolveDialTargetE164(routing)
    if (!isReasonablePstnDialString(dialTargetE164)) {
      dialTargetE164 = FAILSAFE_PRIMARY_CELL_E164
    }

    const wantsAi = String(routing.fallback_type ?? "").toLowerCase() === "ai"
    const ringTimeoutSec = resolveInboundForwardDialTimeoutSeconds(
      Number(routing.ring_timeout_seconds ?? 30) || 30,
      wantsAi
    )

    // Call log + Pusher must never block answering the live call.
    if (routing.user_id && routing.user_id !== "00000000-0000-0000-0000-000000000000") {
      try {
        await insertCallLog({
          user_id: routing.user_id,
          provider_call_sid: event.callControlId,
          from_number: callerE164,
          to_number: businessLineE164 || event.to,
          caller_name: null,
          call_type: "incoming",
          status: "ringing",
          duration_seconds: 0,
          routed_to_receptionist_id: routing.selected_receptionist_id,
          routed_to_name: null,
          has_recording: false,
          recording_url: null,
          recording_duration_seconds: null,
        })
      } catch (e) {
        console.error("[telnyx-cc] call log insert failed:", e)
      }
    }

    const answerState = encodeTelnyxCallControlState(
      baseState(
        routing,
        businessLineE164 || event.to,
        callerE164,
        dialTargetE164,
        ringTimeoutSec,
        "await_caller_answered"
      )
    )
    const answerRes = await telnyxCallControlAnswer(event.callControlId, answerState)
    if (!answerRes.ok) {
      console.error(JSON.stringify({ zing: "telnyx-cc-answer-failed", error: answerRes.error }))
      // Best-effort: try dialing primary cell even if answer payload failed oddly.
      try {
        await dialTechnicianLeg(
          event.callControlId,
          {
            v: 1,
            phase: "await_dial_end",
            userId: routing.user_id,
            businessLineE164: businessLineE164 || event.to,
            callerE164,
            dialTargetE164,
            ringTimeoutSec,
            fallbackType: routing.fallback_type,
            inboundCallControlId: event.callControlId,
          },
          routing
        )
      } catch (dialErr) {
        console.error("Telnyx call.initiated failsafe dial failed:", dialErr)
      }
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
      const answerState = encodeTelnyxCallControlState(
        baseState(failsafe, businessLineE164, callerE164, target, 30, "await_caller_answered")
      )
      await telnyxCallControlAnswer(event.callControlId, answerState)
    } catch (failsafeErr) {
      console.error("Telnyx call.initiated ultimate failsafe failed:", failsafeErr)
    }
  }
}

async function handleCallAnswered(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
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

  const greetingEnabled = isInboundCallerGreetingEnabled(routing)
  if (greetingEnabled) {
    const workspaceName = resolveWorkspaceDisplayName(routing)
    const greetingText = buildInboundCallerGreetingText(workspaceName)
    const nextState = encodeTelnyxCallControlState({
      ...state,
      phase: "await_greeting_end",
      dialTargetE164: state.dialTargetE164 || resolveDialTargetE164(routing) || FAILSAFE_PRIMARY_CELL_E164,
    })
    const speakRes = await telnyxCallControlSpeak(event.callControlId, greetingText, nextState)
    if (!speakRes.ok) {
      console.error(JSON.stringify({ zing: "telnyx-cc-greeting-speak-failed", error: speakRes.error }))
      await dialTechnicianLeg(event.callControlId, state, routing)
    }
    return
  }

  await dialTechnicianLeg(event.callControlId, state, routing)
}

async function handleSpeakEnded(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state) return

  if (state.phase === "await_greeting_end") {
    let routing = await resolveCallControlRouting(state.businessLineE164)
    if (!routing) {
      routing = buildFailsafeRouting({
        userId: state.userId || "00000000-0000-0000-0000-000000000000",
        businessLineE164: state.businessLineE164,
        ownerPhone: state.dialTargetE164 || FAILSAFE_PRIMARY_CELL_E164,
      })
    }
    await dialTechnicianLeg(event.callControlId, state, routing)
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

async function handleCallBridged(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  if (!state) return
  // Bridge events usually arrive on the outbound PSTN leg — still map back to the inbound call log row.
  const inboundSid = resolveInboundCallLogSid(event)
  await persistCallControlBridged(inboundSid, state, event.occurredAt)
}

async function handleCallHangup(
  event: NonNullable<ReturnType<typeof parseTelnyxVoiceWebhookEvent>>
): Promise<void> {
  const state = event.clientState
  const inboundSid = resolveInboundCallLogSid(event)

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

    await persistCallControlDialNoAnswer(inboundSid, event)

    const routing = await getIncomingRoutingForVoiceWebhook(state.businessLineE164)
    if (!routing) {
      await telnyxCallControlHangup(inboundCallControlId)
      return
    }

    const fallback = String(state.fallbackType ?? routing.fallback_type ?? "voicemail").toLowerCase()
    if (fallback === "voicemail" || fallback === "owner") {
      await startVoicemailFlow(inboundCallControlId, state, routing)
      return
    }

    await telnyxCallControlHangup(inboundCallControlId)
    return
  }

  if (isOutboundDialLegEvent(event)) return

  const hadConversation =
    Boolean(state?.inboundCallControlId) &&
    event.hangupCause === "normal_clearing" &&
    state?.phase !== "recording" &&
    state?.phase !== "await_voicemail_prompt_end"

  await finalizeCallControlCallLog(inboundSid, event, {
    callType: state?.phase === "recording" ? "voicemail" : undefined,
    hadConversation,
  })
}

/** Main Call Control webhook switch — returns after scheduling Telnyx actions. */
export async function handleTelnyxCallControlVoiceWebhook(body: Record<string, unknown>): Promise<void> {
  const event = parseTelnyxVoiceWebhookEvent(body)
  if (!event) {
    console.warn("[telnyx-cc] unparseable voice webhook")
    return
  }

  console.log(
    JSON.stringify({
      zing: "telnyx-cc-event",
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
    case "call.bridged":
      await handleCallBridged(event)
      break
    case "call.hangup":
      await handleCallHangup(event)
      break
    default:
      break
  }
}

export function readInboundCallControlEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_CALL_CONTROL || "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}
