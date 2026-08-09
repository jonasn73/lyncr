// Inbound Call Control pipeline: call.initiated → answer → call.answered → speak → speak.ended → dial.

import { getAppUrl } from "@/lib/telnyx"
import {
  telnyxCallControlAnswer,
  telnyxCallControlClientStateUpdate,
  telnyxCallControlDial,
  telnyxCallControlGatherUsingSpeak,
  telnyxCallControlHangup,
  telnyxCallControlRecordStart,
  telnyxCallControlSpeak,
  telnyxListActiveCalls,
} from "@/lib/telnyx-call-control-api"
import {
  abandonHoldQueue,
  bridgeAgentToHoldQueue,
  enterBusyHoldQueue,
  handleHoldLoopGatherEnded,
} from "@/lib/telnyx-call-control-hold-queue"
import { HOLD_AWARE_BUSY_PROMPT } from "@/lib/hold-queue"
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
import { resolveInboundForwardDialTimeoutSeconds } from "@/lib/telnyx-inbound-media-quality"
import { resolveInboundOutboundCallerId } from "@/lib/telnyx-pstn-dial-callerid"
import { resolveVoicemailGreetingText } from "@/lib/voicemail-greeting"
import { isAccountRoutingBlocked, parseAccountStatus } from "@/lib/account-status"
import {
  CAPTURE_DEFAULT_RING_E164,
  CAPTURE_STATUS_HOLD_PRESS1,
  resolveInboundCapturePlan,
  TIED_UP_BOOKING_PROMPT,
} from "@/lib/inbound-time-capture"
import { resolveInboundDialPlan, type InboundDialPlanResult } from "@/lib/inbound-dial-plan"
import { sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"
import {
  getAccountPresence,
  resolvePresenceAutomationGreeting,
} from "@/lib/account-presence"
import { digitsMatchIvrBypass, resolveAutomationGatherNumDigits, resolveHolidayGreetingText } from "@/lib/ivr-automation-settings"
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
  excludeCallControlId?: string | null
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
  } catch (e) {
    console.warn("[telnyx-cc] busy greeting lookup skipped:", e)
  }
  const nextState = encodeTelnyxCallControlState({
    ...state,
    phase: "await_busy_gather_end",
    dialTargetE164: undefined,
    dialReason: "busy_automation",
  })
  console.log(
    lyncrLog("telnyx-cc-busy-automation-gather", {
      callControlId,
      userId: routing.user_id,
      maxDigits,
    })
  )
  const gatherRes = await telnyxCallControlGatherUsingSpeak(callControlId, {
    text: say,
    clientState: nextState,
    maximumDigits: maxDigits,
    timeoutMillis: 8000,
  })
  if (!gatherRes.ok) {
    console.error(lyncrLog("telnyx-cc-busy-gather-failed", { error: gatherRes.error }))
    // Fallback: still try to SMS then hang up so callers are not stranded.
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
  const nextStatePayload: TelnyxCallControlClientState = {
    ...state,
    phase: "await_dial_end",
    inboundCallControlId,
  }
  const nextState = encodeTelnyxCallControlState(nextStatePayload)
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
    if (isTelnyxAuthFailureMessage(dialRes.error)) {
      console.error(
        "[telnyx-cc] CRITICAL: TELNYX_API_KEY auth failure on Dial — update the key in Vercel and redeploy."
      )
    }
    await telnyxCallControlHangup(inboundCallControlId)
    return
  }

  const outboundCallControlId = dialRes.callControlId?.trim() || ""
  console.log(
    JSON.stringify({
      zing: "telnyx-cc-dial-started",
      inboundCallControlId,
      outboundCallControlId: outboundCallControlId || null,
      toTail4: target.replace(/\D/g, "").slice(-4),
      fromTail4: dialFrom.replace(/\D/g, "").slice(-4),
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
    const ringTimeoutSec = resolveInboundForwardDialTimeoutSeconds(
      Number(routing.ring_timeout_seconds ?? 30) || 30,
      wantsAi
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
  const ringTimeoutSec = resolveInboundForwardDialTimeoutSeconds(
    Number(routing.ring_timeout_seconds ?? state.ringTimeoutSec ?? 30) || 30,
    wantsAi
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
    const nextState = encodeTelnyxCallControlState({
      ...enrichedState,
      phase: "await_greeting_end",
    })
    const speakRes = await telnyxCallControlSpeak(event.callControlId, greetingText, nextState)
    if (!speakRes.ok) {
      console.error(JSON.stringify({ zing: "telnyx-cc-greeting-speak-failed", error: speakRes.error }))
      if (dialPlan.reason === "busy_automation" || !isReasonablePstnDialString(dialTargetE164 || "")) {
        await startBusyAutomationFlow(event.callControlId, enrichedState, routing)
      } else {
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
    let routing = await resolveCallControlRouting(state.businessLineE164)
    if (!routing) {
      routing = buildFailsafeRouting({
        userId: state.userId || "00000000-0000-0000-0000-000000000000",
        businessLineE164: state.businessLineE164,
        ownerPhone: state.dialTargetE164 || FAILSAFE_PRIMARY_CELL_E164,
      })
    }
    // Fresh presence check after greeting — Busy must Dial Alex, not the owner.
    const dialPlan = await resolveCallControlInboundDialPlan(
      routing,
      state.businessLineE164,
      event.callControlId
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
  console.log(
    lyncrLog("telnyx-cc-busy-gather-ended", {
      callControlId: event.callControlId,
      digits: digits || null,
      gatherStatus: gatherStatus || null,
    })
  )

  let routing = await resolveCallControlRouting(state.businessLineE164)
  if (!routing) {
    routing = buildFailsafeRouting({
      userId: state.userId || "00000000-0000-0000-0000-000000000000",
      businessLineE164: state.businessLineE164,
      ownerPhone: FAILSAFE_PRIMARY_CELL_E164,
    })
  }

  // Secret bypass or press 2 → ring owner cell (matches TeXML menu / open IVR).
  let bypassMatch = false
  try {
    const presence = await getAccountPresence(routing.user_id)
    bypassMatch = digitsMatchIvrBypass(digits, presence.ivrBypassCode)
  } catch (e) {
    console.warn("[telnyx-cc] bypass lookup skipped:", e)
  }

  if (digits === "2" || bypassMatch) {
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
  // ON_JOB / soft-busy → hold music + Lines Answer.
  let skipHoldForAfterHours = false
  try {
    const presence = await getAccountPresence(routing.user_id)
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
    console.warn("[telnyx-cc] after-hours check skipped:", e)
  }

  if (skipHoldForAfterHours) {
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

  // Timeout / stay on the line → hold music + Telnyx queue (NOT immediate SMS+hangup).
  await enterBusyHoldQueue({
    callControlId: event.callControlId,
    state,
    routing,
    callSessionId: event.callSessionId,
  })
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
      isOutboundLeg: isOutboundDialLegEvent(event),
      outboundFromState: state?.outboundCallControlId ?? null,
      callSessionId: event.callSessionId || null,
    })
  )

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
    if (fallback === "voicemail" || fallback === "owner") {
      await startVoicemailFlow(inboundCallControlId, state, routing)
      return
    }

    await telnyxCallControlHangup(inboundCallControlId)
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

  // Abandon hold queue row + Telnyx leave_queue when the waiting caller disconnects.
  if (
    state?.phase === "await_busy_hold_loop" ||
    state?.holdQueueName ||
    state?.dialReason === "busy_automation"
  ) {
    await abandonHoldQueue(event.callControlId).catch(() => undefined)
  }

  const hadConversation =
    event.hangupCause === "normal_clearing" &&
    state?.phase !== "recording" &&
    state?.phase !== "await_voicemail_prompt_end" &&
    state?.phase !== "await_busy_gather_end" &&
    state?.phase !== "await_busy_sms_confirm_end" &&
    state?.phase !== "await_busy_hold_loop" &&
    (Boolean(state?.inboundCallControlId) || state?.phase === "await_dial_end")

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
    case "call.gather.ended":
      await handleGatherEnded(event)
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
  // Prefer LYNCR_INBOUND_CALL_CONTROL; still accept legacy ZING_* until Vercel is renamed.
  return envFlagOn("INBOUND_CALL_CONTROL")
}
