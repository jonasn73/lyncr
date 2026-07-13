// ============================================
// POST /api/voice/telnyx/incoming
// ============================================
// Telnyx TeXML: when someone calls your Telnyx number, Telnyx fetches
// instructions from this URL. We return TeXML (TwiML-compatible) to route the call.
//
// Per-number routing: looks up routing config for the specific business number
// being called, so different numbers can route to different receptionists.
// Falls back to the user's default config if no number-specific config exists.

import { randomUUID } from "crypto"
import { after } from "next/server"
import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { SITE_NAME } from "@/lib/brand"
import { texmlSayNatural } from "@/lib/texml-say-voice"
import {
  buildInboundGreetingFirstPassResult,
  inboundGreetingPassDone,
  resolveCallerGreetingForDialPass,
  resolveInboundPstnForwardAnswerOnBridge,
  resolveWorkspaceDisplayName,
  isInboundCallerGreetingEnabled,
  shouldPlayCallerRingbackDuringDial,
  shouldPlayInboundGreetingFirstPass,
} from "@/lib/inbound-branded-greeting"
import { buildTelnyxDialFromDisplayName } from "@/lib/telnyx-caller-display"
import {
  getIncomingRoutingForVoiceWebhook,
  getIncomingRoutingByNumber,
  peekIncomingRoutingCache,
  getActivePhoneNumberByE164,
  getReceptionist,
  getRoutingConfigForNumber,
  getUser,
  insertCallLog,
  getUserAccountStatus,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
  bumpTelnyxAiIncomingHitCount,
  isTelnyxInboundDialCallerLegDone,
  markTelnyxInboundDialCallerLegDone,
  warmDatabasePool,
} from "@/lib/db"
import type { RoutingConfig } from "@/lib/types"
import {
  buildAiHandoffGiveUpTeXML,
  buildRedirectOnlyToAiBridgeTeXML,
  buildSayThenRedirectToAiBridgeTeXML,
  buildShortSayThenRedirectToAiBridgeTeXML,
} from "@/lib/telnyx-ai-handoff"
import { buildTelnyxAiAssistantTexml } from "@/lib/telnyx-ai-texml"
import { ensureTelnyxVoiceAiAssistant } from "@/lib/telnyx-ai-assistant-lifecycle"
import { flattenJsonWebhookToStringMap } from "@/lib/telnyx-incoming-webhook-flatten"
import { isAccountRoutingBlocked, buildSuspendedInboundRejectTexml, parseAccountStatus } from "@/lib/account-status"
import {
  origFromQuerySuffixFromRaw,
  resolvePstnDialCallerIdForInboundForward,
} from "@/lib/telnyx-pstn-dial-callerid"
import { shouldEmitVoiceHotPathDebugLogs } from "@/lib/voice-log-gate"
import {
  buildInboundPstnDialAttributes,
  buildInboundPstnNumberAttributes,
  buildFastReceptionistDialTexml,
  buildFastReceptionistDialWebRtcTexml,
  resolveReceptionistSipUri,
  finalizeInboundTexmlXml,
  readInboundRoutingCfgOverlayEnabled,
  resolveInboundForwardDialTimeoutSeconds,
  resolveInboundFastDialTimeoutSeconds,
} from "@/lib/telnyx-inbound-media-quality"
import { buildRoutingPoolDialResponse, getAvailableReceptionistsForLine } from "@/lib/routing-pool"
import { buildReceptionistAnswerUrl } from "@/lib/receptionist-answer-url"
import { buildAdminRoutingOverrideDial, resolveAdminRoutingOverrideE164 } from "@/lib/telnyx-admin-routing-override"
import {
  getActiveRoutingModeForDid,
  getCustomRoutingPhoneForDid,
} from "@/lib/active-routing-mode-db"
import {
  CAPTURE_DEFAULT_RING_E164,
  CAPTURE_STATUS_CALENDAR_BUSY,
  CAPTURE_STATUS_CALENDAR_OFF,
  CAPTURE_STATUS_PRESENCE_CLOSED,
  CAPTURE_STATUS_PRESENCE_ON_JOB,
  DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
  buildCalendarFullDayGatherXml,
  buildCalendarPartialBusyGatherXml,
  buildDayCaptureDialXml,
  buildPresenceClosedGatherXml,
  buildPresenceOnJobGatherXml,
  resolveInboundCapturePlan,
} from "@/lib/inbound-time-capture"

export const runtime = "nodejs"
export const preferredRegion = "iad1"
export const dynamic = "force-dynamic"

/** Resolved once per warm instance — avoids re-reading env on every inbound POST. */
const VOICE_WEBHOOK_APP_URL = getAppUrl()

// Warm Neon pool on cold start so the first real inbound call skips connection setup latency.
void warmDatabasePool()

/**
 * After this many `/incoming` POSTs, optionally emit `<Connect><AIAssistant>` once on `/incoming`.
 * **Default is off (0):** production logs show Telnyx plays “application error, goodbye” when we return
 * `<Connect>` on `/incoming` — only enable by setting e.g. `ZING_AI_LAST_RESORT_CONNECT_HIT=5` if Telnyx confirms it’s valid for your app.
 */
function parseAiLastResortConnectHit(): number {
  const raw = (process.env.ZING_AI_LAST_RESORT_CONNECT_HIT || "").trim() // Read env; empty = use safe default below
  if (raw === "" || raw === "0" || raw === "false") return 0 // **Default off** — avoids Telnyx generic application error on many setups
  const n = parseInt(raw, 10) // Parse explicit number like "5"
  if (!Number.isFinite(n) || n < 1) return 0 // Bad or negative env → treat as disabled (safe)
  return Math.min(Math.floor(n), 15) // Clamp so one typo cannot set a huge value
}

/** When last-resort `<Connect>` is off: give up when `incomingHitCount` is **greater than** this (e.g. cap 8 → 9th POST onward). */
const SILENT_INCOMING_LOOP_CAP = 8

// Pick the first non-empty webhook field (Telnyx / proxies sometimes rename keys).
function pickField(fields: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = fields[key]
    if (value != null && String(value).trim() !== "") return String(value).trim()
  }
  return ""
}

function hasVoiceUrlDialCompletedEvidence(fields: Record<string, string>): boolean {
  const sid = pickField(fields, [
    "DialCallSid",
    "DialSid",
    "ChildCallSid",
    "DialLegSid",
    "dial_call_sid",
  ]).trim()
  if (sid.length > 0) return true
  const durRaw = pickField(fields, [
    "DialCallDuration",
    "DialCallDurationSeconds",
    "DialBridgedDuration",
    "DialDuration",
  ]).trim()
  const dur = parseInt(durRaw, 10)
  return Number.isFinite(dur) && dur > 0
}

/** If `To` is missing from the map, find a value that looks like E.164 — prefer keys that look like the callee, never `From`. */
function inferE164FromFieldMap(fields: Record<string, string>): string {
  const preferKeys = (re: RegExp) => {
    for (const [k, val] of Object.entries(fields)) {
      if (!re.test(k)) continue
      const m = val.match(/\+[1-9]\d{9,14}\b/)
      if (m) return m[0]
    }
    return ""
  }
  const fromDestHint = preferKeys(/to|called|destination|dialed|dialed_number/i)
  if (fromDestHint) return fromDestHint
  for (const [k, val] of Object.entries(fields)) {
    if (/^from$/i.test(k) || /^caller$/i.test(k) || /^remote_party$/i.test(k)) continue
    const m = val.match(/\+[1-9]\d{9,14}\b/)
    if (m) return m[0]
  }
  return ""
}

function resolveCalledParty(fields: Record<string, string>): string {
  const keys = [
    "To",
    "to",
    "Called",
    "called",
    "ToNumber",
    "to_number",
    "CalledNumber",
    "called_number",
    "Destination",
    "destination",
    "CalledVia",
    "dialed_number",
    "DialedNumber",
  ]
  const direct = pickField(fields, keys).trim()
  if (direct) return direct
  return inferE164FromFieldMap(fields)
}

/** True when Telnyx re-posted after a `<Dial>` leg (skip repeat-leg DB on first ring). */
function inboundWebhookLooksLikeDialRepeat(fields: Record<string, string>): boolean {
  const dialOutcome = pickField(fields, [
    "DialCallStatus",
    "DialStatus",
    "DialCallLegStatus",
    "DialCallLegState",
    "dial_call_status",
  ]).trim()
  if (dialOutcome) return true
  return hasVoiceUrlDialCompletedEvidence(fields)
}

function resolveReceptionistDialE164(rawPhone: string): string {
  const fromRow = normalizePhoneNumberE164(rawPhone)
  if (fromRow && isReasonablePstnDialString(fromRow)) return fromRow
  const digits = rawPhone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`
  return ""
}

/** Snapshot already has a dialable PSTN leg (admin override, receptionist cell, or owner). */
function hasDirectInboundPstnTarget(routing: IncomingRoutingRowNonNull): boolean {
  if (resolveAdminRoutingOverrideE164(routing)) return true
  return Boolean(resolveReceptionistDialE164(routing.receptionist_phone || routing.owner_phone || ""))
}

function directPstnLogNumber(fields: Record<string, string>, calledNumberRaw: string): string {
  return pickField(fields, ["To", "to", "Called", "called"]) || calledNumberRaw
}

async function readWebhookFields(req: NextRequest): Promise<Record<string, string>> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase()
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>
      return flattenJsonWebhookToStringMap(body)
    } catch {
      return {}
    }
  }
  try {
    const raw = await req.text()
    return parseTelnyxFormBody(raw)
  } catch {
    return {}
  }
}

/** Parse only the fields the inbound hot path needs (faster than building a full field map). */
function parseTelnyxFormBodyFast(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const params = new URLSearchParams(raw)
  for (const key of [
    "To",
    "to",
    "Called",
    "called",
    "From",
    "from",
    "Caller",
    "CallSid",
    "CallControlId",
    "call_control_id",
    "DialCallStatus",
    "DialStatus",
    "DialCallLegStatus",
    "DialCallLegState",
    "dial_call_status",
  ]) {
    const v = params.get(key)
    if (v) out[key] = v
  }
  return out
}

function parseTelnyxFormBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  new URLSearchParams(raw).forEach((v, k) => {
    out[k] = v
  })
  return out
}

function searchParamsToFields(url: URL): Record<string, string> {
  const out: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    out[k] = v
  })
  return out
}

type TwimlInstance = InstanceType<typeof VoiceResponse>

/** Normal `<Response>` from the Twilio builder, or raw XML (e.g. `<Connect><AIAssistant>`). */
type IncomingCallResult = { kind: "twiml"; texml: TwimlInstance } | { kind: "raw"; xml: string }

type IncomingRoutingRowNonNull = NonNullable<Awaited<ReturnType<typeof getIncomingRoutingByNumber>>>

type InboundWebhookContext = {
  incomingUrl: string
  greetingPassDone: boolean
}

function inboundWebhookContext(reqUrl: string, fields?: Record<string, string>): InboundWebhookContext {
  const parsed = new URL(reqUrl)
  return {
    incomingUrl: reqUrl,
    greetingPassDone: inboundGreetingPassDone(parsed.searchParams, fields),
  }
}

/** When set, dial the admin override PSTN (E.164 + prefix) and skip owner / receptionist / pool routing. */
function tryAdminRoutingOverrideDial(params: {
  routing: IncomingRoutingRowNonNull
  businessLineE164: string
  calledNumber: string
  callerNumber: string
  callSid: string
  callerName: string | null
  appUrl: string
  perfStartMs?: number
  greetingPassDone?: boolean
}): IncomingCallResult | null {
  const built = buildAdminRoutingOverrideDial({
    routing: params.routing,
    businessLineE164: params.businessLineE164,
    callerNumber: params.callerNumber,
    callSid: params.callSid,
    callerName: params.callerName,
    appUrl: params.appUrl,
    resolveOutboundCallerId: resolveInboundOutboundCallerId,
    greetingPassDone: params.greetingPassDone,
  })
  if (!built) return null

  after(() => {
    void insertCallLog({
      user_id: params.routing.user_id,
      provider_call_sid: params.callSid,
      from_number: params.callerNumber.trim() ? normalizePhoneNumberE164(params.callerNumber) : "Unknown",
      to_number: params.businessLineE164 || normalizePhoneNumberE164(params.calledNumber),
      caller_name: params.callerName,
      call_type: "incoming",
      status: "ringing",
      duration_seconds: 0,
      routed_to_receptionist_id: null,
      routed_to_name: "Admin routing override",
      has_recording: false,
      recording_url: null,
      recording_duration_seconds: null,
    }).catch((logErr) => {
      console.error("[Sigo] Call log insert failed (admin override path):", logErr)
    })
  })

  console.log(
    JSON.stringify({
      ...(params.perfStartMs != null ? { execMs: +(performance.now() - params.perfStartMs).toFixed(2) } : {}),
      zing: "telnyx-incoming-admin-routing-override",
      userId: params.routing.user_id,
      callSid: params.callSid,
      overrideTail4: params.routing.admin_routing_override_phone?.replace(/\D/g, "").slice(-4) ?? null,
    })
  )
  return built
}

function inboundWantsAiFallback(routing: IncomingRoutingRowNonNull): boolean {
  return String(routing.fallback_type ?? "").toLowerCase() === "ai"
}

function inboundRingOwnerFirst(routing: IncomingRoutingRowNonNull): boolean {
  return (
    process.env.ZING_AI_RING_OWNER_FIRST === "1" ||
    process.env.ZING_AI_RING_OWNER_FIRST === "true" ||
    routing.ai_ring_owner_first === true
  )
}

function inboundHasReceptionistToDial(routing: IncomingRoutingRowNonNull): boolean {
  const recvId = routing.selected_receptionist_id?.trim() || ""
  if (!recvId) return false
  return Boolean(resolveReceptionistDialE164(routing.receptionist_phone || ""))
}

function resolveInboundRoutedToName(
  routing: IncomingRoutingRowNonNull,
  selectedReceptionistId: string,
  receptionistDisplayName: string | null | undefined
): string | null {
  if (selectedReceptionistId?.trim()) {
    return receptionistDisplayName?.trim() || routing.receptionist_name?.trim() || "Receptionist"
  }
  if (inboundWantsAiFallback(routing) && !inboundRingOwnerFirst(routing)) {
    return "AI Receptionist"
  }
  return "Owner"
}

/** PSTN `<Dial callerId>` for the business line (multi-DID accounts use primary DID when needed). */
function resolveInboundOutboundCallerId(
  routing: IncomingRoutingRowNonNull,
  businessLineE164: string
): string {
  const preferPrimaryCallerId = ["1", "true", "yes", "on"].includes(
    (process.env.ZING_INBOUND_PSTN_CALLER_ID_PRIMARY || "").trim().toLowerCase()
  )
  const primaryE164 = routing.primary_phone_number?.trim()
    ? normalizePhoneNumberE164(routing.primary_phone_number)
    : ""
  const multiLine = routing.active_phone_count >= 2
  let outboundCallerId = businessLineE164
  if (preferPrimaryCallerId) {
    if (primaryE164 && isReasonablePstnDialString(primaryE164)) outboundCallerId = primaryE164
  } else if (
    multiLine &&
    primaryE164 &&
    isReasonablePstnDialString(primaryE164) &&
    isReasonablePstnDialString(businessLineE164)
  ) {
    const dialed10 = businessLineE164.replace(/\D/g, "").slice(-10)
    const primary10 = primaryE164.replace(/\D/g, "").slice(-10)
    if (dialed10.length >= 10 && primary10.length >= 10 && dialed10 !== primary10) {
      outboundCallerId = primaryE164
    }
  }
  if (!isReasonablePstnDialString(outboundCallerId) && primaryE164 && isReasonablePstnDialString(primaryE164)) {
    outboundCallerId = primaryE164
  }
  return outboundCallerId
}

/**
 * Hot path: return `<Dial>` immediately when routing row already has a PSTN target (receptionist or owner).
 * Ringback during setup: Telnyx `ringTone="us"` (or `audioUrl` via ZING_INBOUND_DIAL_RINGBACK_AUDIO_URL) + answerOnBridge.
 */
async function tryFastInboundPstnDial(params: {
  routing: IncomingRoutingRowNonNull
  businessLineE164: string
  calledNumber: string
  callerNumber: string
  callSid: string
  callerName: string | null
  appUrl: string
  perfStartMs?: number
  greetingPassDone?: boolean
}): Promise<IncomingCallResult | null> {
  const { routing, businessLineE164, calledNumber, callerNumber, callSid, callerName, appUrl, perfStartMs, greetingPassDone } =
    params
  const greetingEnabled = isInboundCallerGreetingEnabled(routing)
  // Cell PSTN `<Number>` — never dial the teammate's phone before the caller hears the greeting pass.
  if (shouldPlayInboundGreetingFirstPass(greetingPassDone ?? false, greetingEnabled)) return null

  const hasReceptionist = Boolean(routing.selected_receptionist_id?.trim())
  const dialE164 = resolveReceptionistDialE164(routing.receptionist_phone || routing.owner_phone || "")
  if (!dialE164) return null

  const wantsAiAfterNoAnswer = String(routing.fallback_type ?? "").toLowerCase() === "ai"
  const effectiveRingTimeout = Number(routing.ring_timeout_seconds ?? 30) || 30
  const dialTimeoutSec = resolveInboundForwardDialTimeoutSeconds(effectiveRingTimeout, wantsAiAfterNoAnswer)

  const didDigits = businessLineE164.replace(/\D/g, "")
  const fallbackMode = wantsAiAfterNoAnswer
    ? hasReceptionist
      ? "recv-ai"
      : "owner-ai"
    : hasReceptionist
      ? "recv"
      : "owner"
  const fallbackPathBase =
    didDigits.length >= 10
      ? `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}/n/${didDigits}/${fallbackMode}`
      : `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}`
  const modeQuery = didDigits.length < 10 ? `&zingFbMode=${encodeURIComponent(fallbackMode)}` : ""
  const fbQuery = wantsAiAfterNoAnswer ? "&fb=ai" : ""
  const bnQuery = `&bn=${encodeURIComponent(businessLineE164)}`
  const origFromQuery = origFromQuerySuffixFromRaw(callerNumber)
  const outboundCallerId = resolveInboundOutboundCallerId(routing, businessLineE164)
  const pstnDialCallerE164 = resolvePstnDialCallerIdForInboundForward({
    inboundFromRaw: callerNumber,
    businessOutboundE164: outboundCallerId,
  })
  const answerOnBridge = resolveInboundPstnForwardAnswerOnBridge(greetingPassDone ?? false, greetingEnabled)
  const ownerLegQuery = hasReceptionist ? "" : "&primary=owner&leg=owner-first"
  const action = `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}${bnQuery}${fbQuery}${modeQuery}${ownerLegQuery}${origFromQuery}`

  const workspaceName = resolveWorkspaceDisplayName(routing)
  const callerGreeting = resolveCallerGreetingForDialPass(workspaceName, greetingPassDone ?? false, greetingEnabled)
  const includeRingback = shouldPlayCallerRingbackDuringDial(greetingPassDone ?? false, greetingEnabled)

  const callLogId = await insertCallLog({
    user_id: routing.user_id,
    provider_call_sid: callSid,
    from_number: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : "Unknown",
    to_number: businessLineE164 || normalizePhoneNumberE164(calledNumber),
    caller_name: callerName,
    call_type: "incoming",
    status: "ringing",
    duration_seconds: 0,
    routed_to_receptionist_id: hasReceptionist ? routing.selected_receptionist_id : null,
    routed_to_name: hasReceptionist ? routing.receptionist_name : null,
    has_recording: false,
    recording_url: null,
    recording_duration_seconds: null,
  }).catch((logErr) => {
    console.error("[Sigo] Call log insert failed (fast path):", logErr)
    return null
  })

  // Per-leg answer URL — Telnyx fetches this the instant the callee picks up (cell or WebRTC).
  // `lid` lets the answer webhook push Pusher before any DB read.
  const answerUrl = buildReceptionistAnswerUrl({
    appUrl,
    ownerUserId: routing.user_id,
    toNumber: businessLineE164 || normalizePhoneNumberE164(calledNumber),
    ...(routing.selected_receptionist_id ? { receptionistId: routing.selected_receptionist_id } : {}),
    callSid,
    callLogId,
    businessType: "generic",
    callerNumber: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : null,
    callerName,
    businessName: workspaceName,
  })

  // Endpoint multiplexing (050): a receptionist set to 'WEB' rings their registered browser over
  // Telnyx WebRTC/SIP. We only take the SIP path when a sip_username actually resolves to a URI;
  // otherwise we fall straight back to the PSTN <Number> below so a WEB receptionist without a
  // provisioned/registered endpoint never causes a dropped call. (A no-answer on either path still
  // flows through the same `action` fallback chain → owner / AI / voicemail.)
  const webSipUri =
    hasReceptionist && routing.receptionist_routing_endpoint === "WEB"
      ? resolveReceptionistSipUri(routing.receptionist_sip_username)
      : null
  const dialEndpoint: "web-sip" | "cell-pstn" = webSipUri ? "web-sip" : "cell-pstn"

  const xml = webSipUri
    ? buildFastReceptionistDialWebRtcTexml({
        ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
        answerOnBridge,
        timeout: dialTimeoutSec,
        action,
        sipUri: webSipUri,
        answerUrl,
        ...(callerGreeting ? { callerGreeting } : {}),
        includeRingback,
      })
    : buildFastReceptionistDialTexml({
        ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
        answerOnBridge,
        timeout: dialTimeoutSec,
        action,
        receptionistE164: dialE164,
        answerUrl,
        ...(callerGreeting ? { callerGreeting } : {}),
        includeRingback,
      })

  console.log(
    JSON.stringify({
      // execMs first so the value survives log-viewer truncation (MCP shows the leading chars).
      ...(perfStartMs != null ? { execMs: +(performance.now() - perfStartMs).toFixed(2) } : {}),
      zing: hasReceptionist ? "telnyx-incoming-fast-recv-dial" : "telnyx-incoming-fast-owner-dial",
      userId: routing.user_id,
      callSid,
      answerOnBridge,
      dialTimeoutSec,
      wantsAiAfterNoAnswer,
      dialEndpoint,
      hotPath: "raw-texml",
    })
  )
  return { kind: "raw", xml }
}

/** Skill-pool path: dial all matching platform receptionists when the line has an industry_tag. */
async function tryRoutingPoolInboundDial(params: {
  routing: IncomingRoutingRowNonNull
  businessLineE164: string
  calledNumber: string
  callerNumber: string
  callSid: string
  callerName: string | null
  appUrl: string
  perfStartMs?: number
  greetingPassDone?: boolean
}): Promise<IncomingCallResult | null> {
  const { routing, businessLineE164, calledNumber, callerNumber, callSid, callerName, appUrl, perfStartMs, greetingPassDone } =
    params
  const greetingEnabled = isInboundCallerGreetingEnabled(routing)
  if (shouldPlayInboundGreetingFirstPass(greetingPassDone ?? false, greetingEnabled)) return null

  const line = await getActivePhoneNumberByE164(businessLineE164 || calledNumber)
  if (!line) return null

  const match = await getAvailableReceptionistsForLine(line.id)
  if (!match) return null

  const wantsAiAfterNoAnswer = String(routing.fallback_type ?? "").toLowerCase() === "ai"
  const effectiveRingTimeout = Number(routing.ring_timeout_seconds ?? 30) || 30
  const dialTimeoutSec = resolveInboundForwardDialTimeoutSeconds(effectiveRingTimeout, wantsAiAfterNoAnswer)

  const didDigits = businessLineE164.replace(/\D/g, "")
  const fallbackMode = wantsAiAfterNoAnswer ? "recv-ai" : "recv"
  const fallbackPathBase =
    didDigits.length >= 10
      ? `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}/n/${didDigits}/${fallbackMode}`
      : `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}`
  const modeQuery = didDigits.length < 10 ? `&zingFbMode=${encodeURIComponent(fallbackMode)}` : ""
  const fbQuery = wantsAiAfterNoAnswer ? "&fb=ai" : ""
  const bnQuery = `&bn=${encodeURIComponent(businessLineE164)}`
  const origFromQuery = origFromQuerySuffixFromRaw(callerNumber)
  const outboundCallerId = resolveInboundOutboundCallerId(routing, businessLineE164)
  const pstnDialCallerE164 = resolvePstnDialCallerIdForInboundForward({
    inboundFromRaw: callerNumber,
    businessOutboundE164: outboundCallerId,
  })
  // When the pool engine already skipped private staff and dialed global Lyncr network agents as the
  // FIRST leg (matched_scope === "network"), flag it so /fallback never re-rings the network pool.
  const networkAlreadyTriedQuery = match.matched_scope === "network" ? "&networkAlreadyTried=true" : ""
  const action = `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}${bnQuery}${fbQuery}${modeQuery}&pool=1${networkAlreadyTriedQuery}${origFromQuery}`

  const workspaceName = resolveWorkspaceDisplayName(routing)
  const callerGreeting = resolveCallerGreetingForDialPass(workspaceName, greetingPassDone ?? false, greetingEnabled)
  const includeRingback = shouldPlayCallerRingbackDuringDial(greetingPassDone ?? false, greetingEnabled)

  const firstRecv = match.receptionists[0]
  const callLogId = await insertCallLog({
    user_id: routing.user_id,
    provider_call_sid: callSid,
    from_number: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : "Unknown",
    to_number: businessLineE164 || normalizePhoneNumberE164(calledNumber),
    caller_name: callerName,
    call_type: "incoming",
    status: "ringing",
    duration_seconds: 0,
    routed_to_receptionist_id: firstRecv?.id ?? null,
    routed_to_name: firstRecv?.name ?? `Pool (${match.industry_tag})`,
    has_recording: false,
    recording_url: null,
    recording_duration_seconds: null,
  }).catch((logErr) => {
    console.error("[Sigo] Call log insert failed (routing pool path):", logErr)
    return null
  })

  const xml = buildRoutingPoolDialResponse({
    match,
    ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
    timeout: dialTimeoutSec,
    action,
    greetingPassDone: greetingPassDone ?? false,
    greetingEnabled,
    ...(callerGreeting ? { callerGreeting } : {}),
    includeRingback,
    answer: {
      appUrl,
      callSid,
      callLogId,
      callerNumber: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : null,
      callerName,
      businessName: workspaceName,
    },
  })

  console.log(
    JSON.stringify({
      // execMs first so the value survives log-viewer truncation (MCP shows the leading chars).
      ...(perfStartMs != null ? { execMs: +(performance.now() - perfStartMs).toFixed(2) } : {}),
      zing: "telnyx-incoming-routing-pool-dial",
      userId: routing.user_id,
      callSid,
      industryTag: match.industry_tag,
      poolMode: match.routing_pool_mode,
      poolSize: match.dial_targets.length,
      hotPath: "raw-texml",
    })
  )
  return { kind: "raw", xml }
}

/** Fast path: AI fallback with no PSTN leg — silent Redirect to `/ai-bridge` → `<Connect><AIAssistant>`. */
async function tryFastInboundDirectAiHandoff(params: {
  routing: IncomingRoutingRowNonNull
  businessLineE164: string
  calledNumber: string
  callerNumber: string
  callSid: string
  callerName: string | null
  perfStartMs?: number
}): Promise<NextResponse | null> {
  const { routing, businessLineE164, calledNumber, callerNumber, callSid, callerName, perfStartMs } = params
  if (!inboundWantsAiFallback(routing)) return null
  if (inboundHasReceptionistToDial(routing)) return null
  if (inboundRingOwnerFirst(routing)) return null

  const user = await getUser(routing.user_id)
  let assistantId =
    user?.telnyx_ai_assistant_id?.trim() || process.env.TELNYX_AI_ASSISTANT_ID?.trim() || ""
  if (!assistantId) {
    const ensured = await ensureTelnyxVoiceAiAssistant(routing.user_id)
    if (ensured.linked && ensured.assistantId?.trim()) assistantId = ensured.assistantId.trim()
  }
  if (!assistantId) return null

  const incomingHitCount = await bumpTelnyxAiIncomingHitCount(callSid)
  let handoff = "redirect-silent-ai-bridge"
  let xml: string
  if (incomingHitCount > SILENT_INCOMING_LOOP_CAP) {
    handoff = "ai-handoff-give-up-silent-cap"
    xml = buildAiHandoffGiveUpTeXML()
  } else if (incomingHitCount <= 1) {
    xml = buildRedirectOnlyToAiBridgeTeXML(routing.user_id, callSid)
  } else if (incomingHitCount === 2) {
    handoff = "short-say-redirect-ai-bridge-repeat"
    xml = buildShortSayThenRedirectToAiBridgeTeXML(routing.user_id, callSid)
  } else {
    handoff = "redirect-silent-ai-bridge-repeat"
    xml = buildRedirectOnlyToAiBridgeTeXML(routing.user_id, callSid)
  }

  after(() => {
    void insertCallLog({
      user_id: routing.user_id,
      provider_call_sid: callSid,
      from_number: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : "Unknown",
      to_number: businessLineE164 || normalizePhoneNumberE164(calledNumber),
      caller_name: callerName,
      call_type: "incoming",
      status: "ai-handoff",
      duration_seconds: 0,
      routed_to_receptionist_id: null,
      routed_to_name: "AI Receptionist",
      has_recording: false,
      recording_url: null,
      recording_duration_seconds: null,
    }).catch((logErr) => {
      console.error("[Sigo] Call log insert failed (fast AI path):", logErr)
    })
  })

  console.log(
    JSON.stringify({
      // execMs first so the value survives log-viewer truncation (MCP shows the leading chars).
      ...(perfStartMs != null ? { execMs: +(performance.now() - perfStartMs).toFixed(2) } : {}),
      zing: "telnyx-incoming-fast-ai-direct",
      userId: routing.user_id,
      callSid,
      handoff,
      incomingHitCount,
    })
  )

  return new NextResponse(xml, {
    headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
  })
}

// Shared logic for routing a call (used by both POST and GET handlers)
async function handleIncomingCall(
  calledNumber: string,
  callerNumber: string,
  callSid: string,
  callerName: string | null,
  webhookFieldKeys: string[],
  webhookFields: Record<string, string>,
  inboundCtx?: InboundWebhookContext
): Promise<IncomingCallResult> {
  const texml = new VoiceResponse()
  const appUrl = VOICE_WEBHOOK_APP_URL
  const debug = process.env.NODE_ENV !== "production"

  if (debug) console.log(`[Sigo] Incoming call: To=${calledNumber} From=${callerNumber} CallSid=${callSid}`)

  try {
    // E.164 for DB + fallback URL — must match phone_numbers.number (we also match by digits in SQL).
    const businessLineE164 = calledNumber ? normalizePhoneNumberE164(calledNumber) : ""

    // 1. One cached routing read — everything needed for `<Dial>` (receptionist, fallback, status, primary DID).
    const routing = await getIncomingRoutingForVoiceWebhook(calledNumber)
    if (!routing) {
      console.error(
        "[Sigo] No user/routing for inbound — check phone_numbers or onboarding_profiles.reserved_number matches this line. Detail:",
        JSON.stringify({
          calledRaw: calledNumber,
          businessLineE164,
          digitKey: businessLineE164.replace(/\D/g, ""),
          callerRaw: callerNumber,
          callSid,
          webhookFieldKeys: webhookFieldKeys.slice(0, 40),
          hint: "Ensure an active phone_numbers row or reserved_number exists for this DID; re-save admin override to sync.",
        })
      )
      texmlSayNatural(texml, "Sorry, this number is not configured. Goodbye.")
      texml.hangup()
      return { kind: "twiml", texml }
    }

    // 2. Suspension guard (from join) before any extra DB round trips.
    const statusFromJoin = parseAccountStatus(routing.account_status)
    if (statusFromJoin && isAccountRoutingBlocked(statusFromJoin)) {
      console.warn(
        JSON.stringify({
          zing: "telnyx-incoming-account-suspended",
          userId: routing.user_id,
          accountStatus: statusFromJoin,
          callSid,
        })
      )
      return { kind: "raw", xml: buildSuspendedInboundRejectTexml() }
    }

    const greetingPassDone = inboundCtx?.greetingPassDone ?? false
    const greetingEnabled = isInboundCallerGreetingEnabled(routing)

    if (shouldPlayInboundGreetingFirstPass(greetingPassDone, greetingEnabled) && inboundCtx?.incomingUrl) {
      return buildInboundGreetingFirstPassResult(routing, inboundCtx.incomingUrl)
    }

    const adminOverrideDial = tryAdminRoutingOverrideDial({
      routing,
      businessLineE164,
      calledNumber,
      callerNumber,
      callSid,
      callerName,
      appUrl,
      greetingPassDone,
    })
    if (adminOverrideDial) return adminOverrideDial

    const mightRepeatLeg = inboundWebhookLooksLikeDialRepeat(webhookFields)
    const overlayEnabled = readInboundRoutingCfgOverlayEnabled()

    if (!mightRepeatLeg && !overlayEnabled) {
      if (!hasDirectInboundPstnTarget(routing)) {
        const poolDial = await tryRoutingPoolInboundDial({
          routing,
          businessLineE164,
          calledNumber,
          callerNumber,
          callSid,
          callerName,
          appUrl,
          greetingPassDone,
        })
        if (poolDial) return poolDial
      } else {
        console.log(
          "🚀 [Voice Optimization] Skipping routing pool probe, direct PSTN line detected for number: " +
            directPstnLogNumber(webhookFields, calledNumber)
        )
      }

      if (routing.receptionist_phone?.trim() || routing.owner_phone?.trim()) {
        const fast = await tryFastInboundPstnDial({
          routing,
          businessLineE164,
          calledNumber,
          callerNumber,
          callSid,
          callerName,
          appUrl,
          greetingPassDone,
        })
        if (fast) return fast
      }
    }

    const cfgDid = businessLineE164 || normalizePhoneNumberE164(calledNumber) || calledNumber.trim()
    const routingRecId = routing.selected_receptionist_id?.trim() || ""
    const routingHasRecvPhone = Boolean(routingRecId && routing.receptionist_phone?.trim())

    const [accountStatus, firstLegDone, routingCfgResult, prefetchedRoutingRec] = await Promise.all([
      statusFromJoin != null ? Promise.resolve(statusFromJoin) : getUserAccountStatus(routing.user_id),
      mightRepeatLeg ? isTelnyxInboundDialCallerLegDone(callSid) : Promise.resolve(false),
      overlayEnabled
        ? getRoutingConfigForNumber(routing.user_id, cfgDid).catch((cfgErr) => {
            console.error("[Sigo] getRoutingConfigForNumber on incoming failed (using SQL join only):", cfgErr)
            return null
          })
        : Promise.resolve(null),
      routingRecId && !routingHasRecvPhone
        ? getReceptionist(routingRecId).catch(() => null)
        : Promise.resolve(null),
    ])

    if (isAccountRoutingBlocked(accountStatus)) {
      console.warn(
        JSON.stringify({
          zing: "telnyx-incoming-account-suspended",
          userId: routing.user_id,
          accountStatus,
          callSid,
        })
      )
      return { kind: "raw", xml: buildSuspendedInboundRejectTexml() }
    }

    if (debug) console.log(`[Sigo] Found user ${routing.user_id} (${routing.user_name}) for number ${calledNumber}`)
    if (debug) console.log(`[Sigo] Routing config: receptionist=${routing.selected_receptionist_id || "none"}, fallback=${routing.fallback_type || "owner"}`)

    if (firstLegDone) {
      console.log(
        JSON.stringify({
          zing: "telnyx-incoming-skip-repeat-texml",
          callSid,
          userId: routing.user_id,
          reason: "first-dial-leg-ended",
        })
      )
      texml.hangup()
      return { kind: "twiml", texml }
    }

    const dialOutcomeOnVoiceUrl = pickField(webhookFields, [
      "DialCallStatus",
      "DialStatus",
      "DialCallLegStatus",
      "DialCallLegState",
      "dial_call_status",
    ])
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")

    const dialOutcomeIsNonLive = (s: string) =>
      ["ringing", "ring", "queued", "init", "in-progress", "inprogress", "answered", "early-media"].includes(s)

    if (
      dialOutcomeOnVoiceUrl &&
      !dialOutcomeIsNonLive(dialOutcomeOnVoiceUrl) &&
      dialOutcomeOnVoiceUrl === "completed" &&
      hasVoiceUrlDialCompletedEvidence(webhookFields)
    ) {
      console.log(
        JSON.stringify({
          zing: "telnyx-incoming-dial-completed-on-voice-url",
          callSid,
          userId: routing.user_id,
          dialOutcomeOnVoiceUrl,
        })
      )
      void markTelnyxInboundDialCallerLegDone(callSid)
      texml.hangup()
      return { kind: "twiml", texml }
    }
    if (
      dialOutcomeOnVoiceUrl &&
      !dialOutcomeIsNonLive(dialOutcomeOnVoiceUrl) &&
      dialOutcomeOnVoiceUrl === "completed" &&
      !hasVoiceUrlDialCompletedEvidence(webhookFields)
    ) {
      console.log(
        JSON.stringify({
          zing: "telnyx-incoming-dial-completed-ignored-no-evidence",
          callSid,
          userId: routing.user_id,
          dialOutcomeOnVoiceUrl,
        })
      )
    }

    // 4. Per-DID routing overlay (already fetched in parallel above).
    const routingCfg: RoutingConfig | null = routingCfgResult

    const wantsAiAfterNoAnswer =
      String(routingCfg?.fallback_type ?? routing.fallback_type ?? "").toLowerCase() === "ai"
    const effectiveRingTimeout = Number(routingCfg?.ring_timeout_seconds ?? routing.ring_timeout_seconds ?? 30) || 30
    const aiRingFirstEffective = Boolean(routingCfg?.ai_ring_owner_first ?? routing.ai_ring_owner_first)

    let selectedReceptionistId = routing.selected_receptionist_id?.trim() || ""
    if (routingCfg) {
      const fromCfg = routingCfg.selected_receptionist_id?.trim() || ""
      if (fromCfg !== selectedReceptionistId) {
        console.log(
          JSON.stringify({
            zing: "telnyx-incoming-recv-id-overlay",
            sqlSelectedId: selectedReceptionistId || null,
            cfgSelectedId: fromCfg || null,
            callSid,
            userId: routing.user_id,
          })
        )
      }
      selectedReceptionistId = fromCfg
    }

    let receptionistDialE164 = ""
    let receptionistDisplayName = routing.receptionist_name
    if (selectedReceptionistId) {
      const routingStillMatches =
        selectedReceptionistId === (routing.selected_receptionist_id?.trim() || "")
      if (routingStillMatches && routing.receptionist_phone?.trim()) {
        receptionistDialE164 = resolveReceptionistDialE164(routing.receptionist_phone)
        if (receptionistDialE164) {
          receptionistDisplayName = routing.receptionist_name ?? receptionistDisplayName
        }
      }
      if (!receptionistDialE164) {
        let rec =
          routingStillMatches &&
          prefetchedRoutingRec &&
          String(prefetchedRoutingRec.id) === selectedReceptionistId
            ? prefetchedRoutingRec
            : null
        if (!rec) rec = await getReceptionist(selectedReceptionistId)
        const recOk = Boolean(rec && String(rec.user_id) === String(routing.user_id))
        if (recOk && rec) {
          receptionistDisplayName = rec.name ?? receptionistDisplayName
          if (rec.phone?.trim()) {
            receptionistDialE164 = resolveReceptionistDialE164(rec.phone)
            if (receptionistDialE164 && !routingStillMatches) {
              console.log(
                JSON.stringify({
                  zing: "telnyx-incoming-receptionist-phone-from-db",
                  userId: routing.user_id,
                  receptionistId: selectedReceptionistId,
                  callSid,
                })
              )
            }
          }
        }
        if (!receptionistDialE164) {
          console.error(
            JSON.stringify({
              zing: "telnyx-incoming-receptionist-phone-missing",
              userId: routing.user_id,
              receptionistId: selectedReceptionistId,
              callSid,
              getReceptionistFound: recOk,
            })
          )
        }
      }
    }
    const hasReceptionist = Boolean(selectedReceptionistId && receptionistDialE164)

    // 4. Log the incoming call before `<Dial>` so answer webhooks can broadcast immediately.
    let callLogId: string | null = null
    try {
      callLogId = await insertCallLog({
        user_id: routing.user_id,
        provider_call_sid: callSid,
        from_number: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : "Unknown",
        to_number: businessLineE164 || normalizePhoneNumberE164(calledNumber),
        caller_name: callerName,
        call_type: "incoming",
        status: "ringing",
        duration_seconds: 0,
        routed_to_receptionist_id: selectedReceptionistId || null,
        routed_to_name: null,
        has_recording: false,
        recording_url: null,
        recording_duration_seconds: null,
      })
    } catch (logErr) {
      console.error("[Sigo] Call log insert failed (continuing with routing):", logErr)
    }

    // 5. Route: receptionist (per-number or default) → owner's cell as fallback
    // PSTN B-leg caller ID is chosen later (`pstnDialCallerE164`): default = inbound caller; optional env = business line.
    /**
     * **Default (AI + no receptionist):** silent **`<Redirect>`** to `/ai-bridge` → `<Connect><AIAssistant>`.
     * Putting `<Connect>` on the first `/incoming` response often goes **dead-air** on Telnyx.
     * **`ZING_AI_HANDOFF_TWO_STEP`:** Say + Redirect (repeats if Telnyx re-fetches `/incoming` — avoid unless needed).
     * **`ZING_AI_CONNECT_DIRECT`:** `<Connect>` on `/incoming` only (experimental).
     * **`ZING_AI_RING_OWNER_FIRST` or dashboard “Ring my phone first”:** when there is **no** receptionist to `<Dial>`,
     * affects whether we send Voice AI straight to `/ai-bridge` vs your cell first (`useDirectAiWhenNoReceptionist`).
     * A configured receptionist is **always** the first PSTN ring.
     *
     * **Do not** skip the redirect when `CallStatus` looks “live” on the **first** `/incoming` request —
     * Telnyx sometimes sends `in-progress` / `answered` while fetching TeXML; `<Connect>` on that first
     * response often goes **dead-air** (one ring, then silence).
     */
    const ringOwnerFirst =
      process.env.ZING_AI_RING_OWNER_FIRST === "1" ||
      process.env.ZING_AI_RING_OWNER_FIRST === "true" ||
      aiRingFirstEffective === true
    const twoStepAiHandoff =
      process.env.ZING_AI_HANDOFF_TWO_STEP === "1" || process.env.ZING_AI_HANDOFF_TWO_STEP === "true" // true = play “please hold” then redirect
    const connectDirectIncoming =
      process.env.ZING_AI_CONNECT_DIRECT === "1" || process.env.ZING_AI_CONNECT_DIRECT === "true" // true = skip redirect; <Connect> on /incoming (can be quiet)
    const useDirectAiWhenNoReceptionist =
      wantsAiAfterNoAnswer && !hasReceptionist && !ringOwnerFirst // AI fallback with nobody to Dial first

    const tail4 = (e164: string) => {
      const d = e164.replace(/\D/g, "")
      return d.length >= 4 ? d.slice(-4) : null
    }
    const ownerNorm = normalizePhoneNumberE164(routing.owner_phone)
    if (shouldEmitVoiceHotPathDebugLogs()) {
      console.log(
        JSON.stringify({
          zing: "telnyx-incoming-routing-flags",
          userId: routing.user_id,
          cfgDid: businessLineE164 || normalizePhoneNumberE164(calledNumber) || calledNumber.trim(),
          calledLen: calledNumber.trim().length,
          wantsAiAfterNoAnswer,
          hasReceptionist,
          firstPstnLeg: hasReceptionist ? "receptionist" : "owner_cell",
          selectedRecvConfigured: Boolean(selectedReceptionistId),
          recvDialDigitLen: receptionistDialE164.replace(/\D/g, "").length,
          recvPhoneTail4: receptionistDialE164 ? tail4(receptionistDialE164) : null,
          recvDisplayName: receptionistDisplayName || null,
          ownerPhoneTail4: ownerNorm ? tail4(ownerNorm) : null,
          recvPstnDialPlain: true,
          aiRingFirstFromCfg: aiRingFirstEffective,
          ringOwnerFirstEffective: ringOwnerFirst,
          useDirectAiWhenNoReceptionist,
          effectiveRingTimeout,
          envRingFirst:
            process.env.ZING_AI_RING_OWNER_FIRST === "1" || process.env.ZING_AI_RING_OWNER_FIRST === "true",
        })
      )
    }

    const callStatusRaw = pickField(webhookFields, [
      // Telnyx may use different key names; try each until one has a value
      "CallStatus",
      "CallState",
      "call_status",
      "CallLegStatus",
    ])
    const callStatus = callStatusRaw.trim().toLowerCase().replace(/_/g, "-") // Normalize so “in_progress” matches “in-progress” (logged for debugging only)

    if (useDirectAiWhenNoReceptionist) {
      let user = await getUser(routing.user_id) // Load DB row for this business user
      let assistantId =
        user?.telnyx_ai_assistant_id?.trim() || process.env.TELNYX_AI_ASSISTANT_ID?.trim() || "" // Prefer per-user id, else env fallback
      if (!assistantId) {
        const ensured = await ensureTelnyxVoiceAiAssistant(routing.user_id) // Create/link assistant via Telnyx API if missing
        if (ensured.linked && ensured.assistantId?.trim()) assistantId = ensured.assistantId.trim() // Use newly created id
      }
      if (assistantId) {
        /** 1 = first `/incoming` for this call_sid; 2+ = Telnyx re-posted (see scripts/013 + 014). */
        const incomingHitCount = connectDirectIncoming ? 1 : await bumpTelnyxAiIncomingHitCount(callSid)
        const lastResortHit = parseAiLastResortConnectHit() // Nth hit tries <Connect> on /incoming only if env set (default: disabled)
        const useLastResortConnect = lastResortHit > 0 && !connectDirectIncoming // Skip when already forcing connect on first hit
        let handoff: string // Short label for logs so you can see which branch ran
        let xml: string // TeXML string we return to Telnyx
        if (useLastResortConnect && incomingHitCount > lastResortHit) {
          // Loops continued after last-resort <Connect> — fail fast instead of ~20 silent redirects
          handoff = "ai-handoff-give-up-after-last-resort"
          xml = buildAiHandoffGiveUpTeXML() // Clear message + hangup
        } else if (!useLastResortConnect && incomingHitCount > SILENT_INCOMING_LOOP_CAP) {
          handoff = "ai-handoff-give-up-silent-cap" // Last-resort disabled; cap silent loops
          xml = buildAiHandoffGiveUpTeXML()
        } else if (twoStepAiHandoff) {
          if (useLastResortConnect && incomingHitCount === lastResortHit) {
            handoff = "connect-aiassistant-last-resort-incoming" // Try <Connect> on /incoming once at hit N
            xml = buildTelnyxAiAssistantTexml(assistantId) // Some Telnyx builds only attach AI here after redirects
          } else if (incomingHitCount <= 1) {
            handoff = "say-redirect-ai-bridge" // First hit: full hold line + GET /ai-bridge
            xml = buildSayThenRedirectToAiBridgeTeXML(routing.user_id, callSid) // TeXML with Say + Pause + Redirect
          } else if (incomingHitCount === 2) {
            handoff = "short-say-redirect-ai-bridge-repeat" // One spoken repeat (avoids Telnyx issues with silent-only repeat)
            xml = buildShortSayThenRedirectToAiBridgeTeXML(routing.user_id, callSid) // One-time short line + Redirect
          } else {
            handoff = "redirect-silent-ai-bridge-repeat" // Hit 3+ until last-resort: silent Redirect
            xml = buildRedirectOnlyToAiBridgeTeXML(routing.user_id, callSid)
          }
        } else if (connectDirectIncoming) {
          handoff = "connect-aiassistant-in-incoming" // Log label: experimental single-step Connect
          xml = buildTelnyxAiAssistantTexml(assistantId) // Only <Connect><AIAssistant> — may dead-air on first hit
        } else if (useLastResortConnect && incomingHitCount === lastResortHit) {
          handoff = "connect-aiassistant-last-resort-incoming"
          xml = buildTelnyxAiAssistantTexml(assistantId)
        } else if (incomingHitCount <= 1) {
          handoff = "redirect-silent-ai-bridge" // First POST this call_sid — silent Redirect → /ai-bridge
          xml = buildRedirectOnlyToAiBridgeTeXML(routing.user_id, callSid) // Telnyx GETs /ai-bridge for <Connect>
        } else if (incomingHitCount === 2) {
          handoff = "short-say-redirect-ai-bridge-repeat" // First repeat only
          xml = buildShortSayThenRedirectToAiBridgeTeXML(routing.user_id, callSid)
        } else {
          handoff = "redirect-silent-ai-bridge-repeat" // Hit 3+ until last-resort
          xml = buildRedirectOnlyToAiBridgeTeXML(routing.user_id, callSid)
        }
        if (shouldEmitVoiceHotPathDebugLogs()) {
          console.log(
            JSON.stringify({
              zing: "telnyx-incoming-ai-direct", // Fixed key: search Vercel logs for this
              userId: routing.user_id, // Which business user this call belongs to
              handoff, // Which branch above ran
              callStatus: callStatus || null, // Raw normalized status from webhook (empty on first ring sometimes)
              incomingHitCount, // Logged every POST
              lastResortConnectHit: useLastResortConnect ? lastResortHit : null, // null = disabled (default)
              note: useLastResortConnect
                ? "Experimental: <Connect> on /incoming at lastResortConnectHit; next hit = give up. Telnyx may error — unset env to use silent cap only."
                : `Last-resort <Connect> on /incoming is off. When incomingHitCount > ${SILENT_INCOMING_LOOP_CAP} we play ${SITE_NAME} give-up (not Telnyx error). Set ZING_AI_LAST_RESORT_CONNECT_HIT=N to try Connect on hit N.`,
            })
          )
        }
        return { kind: "raw", xml } // Bypass VoiceResponse builder because helpers return full XML strings
      }
      console.warn(
        "[Sigo] AI direct path skipped — no assistant id; falling back to <Dial> owner + /fallback webhook."
      )
    }

    // When the next step is Voice AI, cap ring time on the first leg (~4 rings) before `/fallback` → AI.
    const receptionistRingSec = resolveInboundForwardDialTimeoutSeconds(
      effectiveRingTimeout || 20,
      wantsAiAfterNoAnswer
    )
    const ownerRingSec = resolveInboundForwardDialTimeoutSeconds(
      effectiveRingTimeout || 30,
      wantsAiAfterNoAnswer
    )

    const didDigits = businessLineE164.replace(/\D/g, "")
    const fallbackMode = wantsAiAfterNoAnswer
      ? hasReceptionist
        ? "recv-ai"
        : "owner-ai"
      : hasReceptionist
        ? "recv"
        : "owner"
    const fallbackPathBase =
      didDigits.length >= 10
        ? `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}/n/${didDigits}/${fallbackMode}`
        : `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}`
    const modeQuery = didDigits.length < 10 ? `&zingFbMode=${encodeURIComponent(fallbackMode)}` : ""
    const fbQuery = wantsAiAfterNoAnswer ? "&fb=ai" : ""
    const bnQuery = `&bn=${encodeURIComponent(businessLineE164)}`

    // PSTN `<Dial callerId>` must be a Telnyx-owned E.164 on your outbound voice profile. A newly purchased second DID
    // often is not yet usable as outbound caller ID on the same TeXML app; using the account’s first active DID for
    // PSTN legs when multiple lines exist avoids failed/fake rings on the non-primary number. Optional override:
    // `ZING_INBOUND_PSTN_CALLER_ID_PRIMARY=1` forces primary caller ID even on the primary line’s inbound leg.
    const preferPrimaryCallerId = ["1", "true", "yes", "on"].includes(
      (process.env.ZING_INBOUND_PSTN_CALLER_ID_PRIMARY || "").trim().toLowerCase()
    )
    const outboundCallerId = resolveInboundOutboundCallerId(routing, businessLineE164)
    const primaryE164 = routing.primary_phone_number?.trim()
      ? normalizePhoneNumberE164(routing.primary_phone_number)
      : ""
    const multiLine = routing.active_phone_count >= 2

    if (preferPrimaryCallerId && primaryE164 && isReasonablePstnDialString(primaryE164) && shouldEmitVoiceHotPathDebugLogs()) {
      console.log(
        JSON.stringify({
          zing: "telnyx-incoming-callerid-forced-primary-env",
          callSid,
          userId: routing.user_id,
          dialedLine: businessLineE164 || null,
          callerIdUsed: outboundCallerId,
        })
      )
    } else if (
      multiLine &&
      primaryE164 &&
      isReasonablePstnDialString(primaryE164) &&
      isReasonablePstnDialString(businessLineE164) &&
      outboundCallerId === primaryE164 &&
      shouldEmitVoiceHotPathDebugLogs()
    ) {
      const dialed10 = businessLineE164.replace(/\D/g, "").slice(-10)
      const primary10 = primaryE164.replace(/\D/g, "").slice(-10)
      if (dialed10.length >= 10 && primary10.length >= 10 && dialed10 !== primary10) {
        console.log(
          JSON.stringify({
            zing: "telnyx-incoming-callerid-auto-primary-multi-did",
            callSid,
            userId: routing.user_id,
            dialedLine: businessLineE164,
            callerIdUsed: outboundCallerId,
          })
        )
      }
    }

    if (!isReasonablePstnDialString(outboundCallerId)) {
      console.error(
        JSON.stringify({
          zing: "telnyx-incoming-callerid-missing",
          callSid,
          userId: routing.user_id,
          businessLineE164: businessLineE164 || null,
        })
      )
    }

    const origFromQuery = origFromQuerySuffixFromRaw(callerNumber)
    const pstnDialCallerE164 = resolvePstnDialCallerIdForInboundForward({
      inboundFromRaw: callerNumber,
      businessOutboundE164: outboundCallerId,
    })
    const answerOnBridge = resolveInboundPstnForwardAnswerOnBridge(greetingPassDone, greetingEnabled)
    if (shouldEmitVoiceHotPathDebugLogs()) {
      console.log(
        JSON.stringify({
          zing: "telnyx-incoming-pstn-dial-callerid",
          callSid,
          useBusinessLineEnv: ["1", "true", "yes", "on"].includes(
            (process.env.ZING_INBOUND_DIAL_CALLER_ID_USE_BUSINESS_LINE || "").trim().toLowerCase()
          ),
          pstnDialCallerTail4: pstnDialCallerE164 ? tail4(pstnDialCallerE164) : null,
          businessOutboundTail4: isReasonablePstnDialString(outboundCallerId) ? tail4(outboundCallerId) : null,
          answerOnBridge,
        })
      )
    }
    // Outbound CNAM hint: prefer line label when set (not default "Main Line"); else account business name.
    const lineLbl = routing.phone_line_label.trim()
    const fromDisplaySource =
      lineLbl && lineLbl.toLowerCase() !== "main line" ? lineLbl : routing.business_name
    const fromDisplayName = buildTelnyxDialFromDisplayName(fromDisplaySource)

    const pstnNumberAttrs = buildInboundPstnNumberAttributes()

    const workspaceName = resolveWorkspaceDisplayName(routing)
    const callerGreeting = resolveCallerGreetingForDialPass(workspaceName, greetingPassDone, greetingEnabled)
    if (callerGreeting) {
      texmlSayNatural(texml, callerGreeting)
    }
    const includeRingback = shouldPlayCallerRingbackDuringDial(greetingPassDone, greetingEnabled)

    if (hasReceptionist) {
      const recPhone = receptionistDialE164
      if (debug) console.log(`[Sigo] Routing to receptionist: ${receptionistDisplayName || "Receptionist"} (${recPhone})`)
      const dial = texml.dial(
        buildInboundPstnDialAttributes({
          ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
          answerOnBridge,
          timeout: receptionistRingSec,
          action: `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}${bnQuery}${fbQuery}${origFromQuery}`,
          method: "POST",
          includeRingback,
        }) as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0]
      )
      // Screen the agent's cell leg ("Press any key to connect") + pop their HUD on answer.
      const recvAnswerUrl = selectedReceptionistId
        ? buildReceptionistAnswerUrl({
            appUrl,
            ownerUserId: routing.user_id,
            toNumber: businessLineE164 || normalizePhoneNumberE164(calledNumber),
            receptionistId: selectedReceptionistId,
            callSid,
            callLogId,
            businessType: "generic",
            callerNumber: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : null,
            callerName,
            businessName: workspaceName,
          })
        : buildReceptionistAnswerUrl({
            appUrl,
            ownerUserId: routing.user_id,
            toNumber: businessLineE164 || normalizePhoneNumberE164(calledNumber),
            callSid,
            callLogId,
            businessType: "generic",
            callerNumber: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : null,
            callerName,
            businessName: workspaceName,
          })
      dial.number({ ...pstnNumberAttrs, url: recvAnswerUrl, method: "POST" }, recPhone)
    } else {
      const ownerPhone = normalizePhoneNumberE164(routing.owner_phone)
      if (debug) console.log(`[Sigo] No receptionist assigned, routing to owner: ${ownerPhone}`)
      const ownerAnswerUrl = buildReceptionistAnswerUrl({
        appUrl,
        ownerUserId: routing.user_id,
        toNumber: businessLineE164 || normalizePhoneNumberE164(calledNumber),
        callSid,
        callLogId,
        businessType: "generic",
        callerNumber: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : null,
        callerName,
        businessName: workspaceName,
      })
      const dial = texml.dial(
        buildInboundPstnDialAttributes({
          ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
          ...(fromDisplayName ? { fromDisplayName } : {}),
          answerOnBridge,
          timeout: ownerRingSec,
          action: `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}&primary=owner&leg=owner-first${bnQuery}${fbQuery}${modeQuery}${origFromQuery}`,
          method: "POST",
          includeRingback,
        }) as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0]
      )
      dial.number({ ...pstnNumberAttrs, url: ownerAnswerUrl, method: "POST" }, ownerPhone)
    }
  } catch (error) {
    console.error("[Telnyx] Error in incoming webhook:", error)
    texmlSayNatural(texml, "We're sorry, there was an error connecting your call. Please try again later.")
    texml.hangup()
  }

  if (debug) console.log(`[Sigo] TeXML response: ${texml.toString().slice(0, 500)}`)
  return { kind: "twiml", texml }
}

function texmlResponseBody(out: IncomingCallResult): string {
  const raw = out.kind === "raw" ? out.xml : out.texml.toString()
  return out.kind === "raw" ? raw : finalizeInboundTexmlXml(raw)
}

/** DB-backed fast path: resolve routing then return raw `<Dial>` before heavy handleIncomingCall. */
async function tryFastInboundReceptionistResponse(
  fields: Record<string, string>,
  perfStartMs?: number,
  inboundCtx?: InboundWebhookContext
): Promise<NextResponse | null> {
  if (inboundWebhookLooksLikeDialRepeat(fields)) return null
  if (readInboundRoutingCfgOverlayEnabled()) return null

  const calledNumberRaw = resolveCalledParty(fields)
  if (!calledNumberRaw.trim()) return null

  const memHit = peekIncomingRoutingCache(calledNumberRaw)
  const t0 = Date.now()
  const routing = memHit ?? (await getIncomingRoutingForVoiceWebhook(calledNumberRaw))
  const lookupMs = Date.now() - t0

  if (!routing) return null

  const statusFromJoin = parseAccountStatus(routing.account_status)
  if (statusFromJoin && isAccountRoutingBlocked(statusFromJoin)) {
    return new NextResponse(buildSuspendedInboundRejectTexml(), {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    })
  }

  // Time-based capture (Your Phone / Smart IVR): night menu vs day 15s Dial + busy SMS.
  // Skipped for Lyncr Pool + Custom Routing (handled below / later).
  const businessLineE164Early = normalizePhoneNumberE164(calledNumberRaw)
  if (businessLineE164Early) {
    // Custom Routing mode — forward straight to the configured 10-digit target.
    try {
      const customTarget = await getCustomRoutingPhoneForDid(businessLineE164Early)
      if (customTarget && isReasonablePstnDialString(customTarget)) {
        const vr = new VoiceResponse()
        const dial = vr.dial({
          callerId: businessLineE164Early,
          timeout: 30,
          answerOnBridge: true,
        } as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0])
        dial.number(customTarget)
        console.log(
          JSON.stringify({
            zing: "telnyx-incoming-custom-routing",
            toTail4: customTarget.replace(/\D/g, "").slice(-4),
            didTail4: businessLineE164Early.replace(/\D/g, "").slice(-4),
          })
        )
        return new NextResponse(vr.toString(), {
          headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
        })
      }
    } catch (e) {
      console.warn("[telnyx-incoming] custom routing check failed:", e)
    }

    try {
      const routingMode = await getActiveRoutingModeForDid(businessLineE164Early)
      if (routingMode === "your_phone" || routingMode === "smart_ivr") {
        const callSidEarly =
          pickField(fields, ["CallSid", "CallControlId", "call_control_id"]) || ""
        const fromEarly = pickField(fields, ["From", "Caller", "from"]) || ""
        const captureBase = `${VOICE_WEBHOOK_APP_URL}/api/telnyx-capture`
        const plan = await resolveInboundCapturePlan({ ownerUserId: routing.user_id })
        const ownerDial =
          normalizePhoneNumberE164(routing.owner_phone) ||
          (isReasonablePstnDialString(routing.owner_phone) ? routing.owner_phone.trim() : "") ||
          CAPTURE_DEFAULT_RING_E164

        const initialRoutedName =
          plan.kind === "presence_closed"
            ? CAPTURE_STATUS_PRESENCE_CLOSED
            : plan.kind === "presence_on_job"
              ? CAPTURE_STATUS_PRESENCE_ON_JOB
              : plan.kind === "calendar_full_day"
                ? CAPTURE_STATUS_CALENDAR_OFF
                : plan.kind === "calendar_partial"
                  ? CAPTURE_STATUS_CALENDAR_BUSY
                  : "Owner"
        const initialCallType = plan.kind === "day_dial" ? "incoming" : "missed"

        if (callSidEarly && routing.user_id) {
          after(() => {
            void insertCallLog({
              user_id: routing.user_id,
              provider_call_sid: callSidEarly,
              from_number: fromEarly.trim()
                ? normalizePhoneNumberE164(fromEarly)
                : "Unknown",
              to_number: businessLineE164Early,
              caller_name: pickField(fields, ["CallerName", "caller_name"]) || null,
              call_type: initialCallType,
              status: "ringing",
              duration_seconds: 0,
              routed_to_receptionist_id: null,
              routed_to_name: initialRoutedName,
              has_recording: false,
              recording_url: null,
              recording_duration_seconds: null,
            })
              .then(async (id) => {
                if (id) return
                const { updateCallLog } = await import("@/lib/db")
                await updateCallLog(callSidEarly, {
                  routed_to_name: initialRoutedName,
                  call_type: initialCallType,
                })
              })
              .catch(async (logErr) => {
                console.error("[Sigo] Call log insert failed (time capture):", logErr)
                try {
                  const { updateCallLog } = await import("@/lib/db")
                  await updateCallLog(callSidEarly, {
                    routed_to_name: initialRoutedName,
                    call_type: initialCallType,
                  })
                } catch (e2) {
                  console.error("[Sigo] Call log capture retag failed:", e2)
                }
              })
          })
        }

        let xml: string
        if (plan.kind === "presence_closed") {
          xml = buildPresenceClosedGatherXml(`${captureBase}?step=presence-closed`)
        } else if (plan.kind === "calendar_full_day") {
          xml = buildCalendarFullDayGatherXml(`${captureBase}?step=calendar-off`)
        } else if (plan.kind === "calendar_partial") {
          xml = buildCalendarPartialBusyGatherXml(`${captureBase}?step=calendar-busy`)
        } else if (plan.kind === "presence_on_job") {
          xml = buildPresenceOnJobGatherXml(`${captureBase}?step=presence-on-job`)
        } else {
          xml = buildDayCaptureDialXml({
            ringE164: ownerDial,
            actionUrl: `${captureBase}?step=day-fallback`,
            callerId: businessLineE164Early,
            timeoutSeconds: DAY_CAPTURE_DIAL_TIMEOUT_SECONDS,
          })
        }

        console.log(
          JSON.stringify({
            ...(perfStartMs != null
              ? { execMs: +(performance.now() - perfStartMs).toFixed(2) }
              : {}),
            zing: `telnyx-incoming-capture-${plan.kind}`,
            callSid: callSidEarly || null,
            didTail4: businessLineE164Early.replace(/\D/g, "").slice(-4) || null,
            ringTail4: ownerDial.replace(/\D/g, "").slice(-4) || null,
            lookupMs,
            routingSource: memHit ? "memory" : "db",
            routingMode,
            planKind: plan.kind,
            ...(plan.kind === "calendar_full_day" || plan.kind === "calendar_partial"
              ? { dateKey: plan.dateKey, timeHhMm: plan.timeHhMm, reason: plan.reason }
              : {}),
          })
        )
        return new NextResponse(xml, {
          headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
        })
      }
    } catch (e) {
      console.warn("[telnyx-incoming] time capture path failed:", e)
    }
  }

  const greetingPassDone = inboundCtx?.greetingPassDone ?? false
  const greetingEnabled = isInboundCallerGreetingEnabled(routing)

  // Safety net when Edge/middleware miss pass 1 — never `<Dial>` (ringback) before the greeting.
  if (shouldPlayInboundGreetingFirstPass(greetingPassDone, greetingEnabled) && inboundCtx?.incomingUrl) {
    const greetingPass = buildInboundGreetingFirstPassResult(routing, inboundCtx.incomingUrl)
    return new NextResponse(texmlResponseBody(greetingPass), {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    })
  }

  const callSidRaw = pickField(fields, ["CallSid", "CallControlId", "call_control_id"])
  const callSid = callSidRaw.trim() || `zing-${randomUUID()}`
  const callerNumber = pickField(fields, ["From", "from", "Caller", "caller", "RemoteParty"])
  const callerName = pickField(fields, ["CallerName", "CallerIDName"]) || null
  const businessLineE164 = normalizePhoneNumberE164(calledNumberRaw)

  const adminOverrideDial = tryAdminRoutingOverrideDial({
    routing,
    businessLineE164,
    calledNumber: calledNumberRaw,
    callerNumber,
    callSid,
    callerName,
    appUrl: VOICE_WEBHOOK_APP_URL,
    perfStartMs,
    greetingPassDone,
  })
  if (adminOverrideDial) {
    return new NextResponse(texmlResponseBody(adminOverrideDial), {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    })
  }

  if (
    inboundWantsAiFallback(routing) &&
    !inboundHasReceptionistToDial(routing) &&
    !inboundRingOwnerFirst(routing)
  ) {
    const directAi = await tryFastInboundDirectAiHandoff({
      routing,
      businessLineE164,
      calledNumber: calledNumberRaw,
      callerNumber,
      callSid,
      callerName,
      perfStartMs,
    })
    if (directAi) {
      console.log(
        JSON.stringify({
          ...(perfStartMs != null ? { execMs: +(performance.now() - perfStartMs).toFixed(2) } : {}),
          zing: "telnyx-incoming-fast-ai-path",
          callSid,
          lookupMs,
          routingSource: memHit ? "memory" : "db",
        })
      )
      return directAi
    }
  }

  if (!hasDirectInboundPstnTarget(routing)) {
    const poolDial = await tryRoutingPoolInboundDial({
      routing,
      businessLineE164,
      calledNumber: calledNumberRaw,
      callerNumber,
      callSid,
      callerName,
      appUrl: VOICE_WEBHOOK_APP_URL,
      perfStartMs,
      greetingPassDone,
    })
    if (poolDial) {
      return new NextResponse(texmlResponseBody(poolDial), {
        headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
      })
    }
    return null
  }

  console.log(
    "🚀 [Voice Optimization] Skipping routing pool probe, direct PSTN line detected for number: " +
      directPstnLogNumber(fields, calledNumberRaw)
  )

  const fast = await tryFastInboundPstnDial({
    routing,
    businessLineE164,
    calledNumber: calledNumberRaw,
    callerNumber,
    callSid,
    callerName,
    appUrl: VOICE_WEBHOOK_APP_URL,
    perfStartMs,
    greetingPassDone,
  })
  if (!fast) return null

  console.log(
    JSON.stringify({
      ...(perfStartMs != null ? { execMs: +(performance.now() - perfStartMs).toFixed(2) } : {}),
      zing: "telnyx-incoming-fast-recv-path",
      userId: routing.user_id,
      callSid,
      lookupMs,
      routingSource: memHit ? "memory" : "db",
      dialTail4: (routing.receptionist_phone || routing.owner_phone || "").replace(/\D/g, "").slice(-4) || null,
    })
  )

  return new NextResponse(texmlResponseBody(fast), {
    headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
  })
}

export async function POST(req: NextRequest) {
  // High-resolution wall clock (sub-millisecond). Captures total server-side execution from the
  // moment the call webhook lands to the moment the TeXML response object is fully constructed,
  // across EVERY return path below (the single-pass fast path and the full handleIncomingCall path).
  const perfStart = performance.now()
  try {
    return await processInboundPost(req, perfStart)
  } finally {
    // Runs right before the response is handed back to Next.js, no matter which branch returned it.
    // ms value is logged FIRST so it stays visible even when log viewers truncate the message.
    const executionTime = performance.now() - perfStart
    console.log(`${executionTime.toFixed(2)}ms - voice-webhook-exec - ${req.nextUrl.pathname}`)
  }
}

async function processInboundPost(req: NextRequest, perfStartMs: number): Promise<NextResponse> {
  const handlerT0 = Date.now()
  const contentType = (req.headers.get("content-type") || "").toLowerCase()
  let fields: Record<string, string>

  if (contentType.includes("application/json")) {
    fields = await readWebhookFields(req)
  } else {
    const raw = await req.text()
    fields = parseTelnyxFormBodyFast(raw)
    const inboundCtx = inboundWebhookContext(req.url, fields)
    // Pass 2 (`lyncrGreet=1`) routes here after pass-1 greeting when enabled for the line.
    const hot = await tryFastInboundReceptionistResponse(fields, perfStartMs, inboundCtx)
    if (hot) {
      console.log(JSON.stringify({ zing: "telnyx-incoming-post-timing", totalMs: Date.now() - handlerT0, path: "fast" }))
      return hot
    }
    fields = parseTelnyxFormBody(raw)
  }

  const inboundCtx = inboundWebhookContext(req.url, fields)

  const hot = await tryFastInboundReceptionistResponse(fields, perfStartMs, inboundCtx)
  if (hot) {
    console.log(JSON.stringify({ zing: "telnyx-incoming-post-timing", totalMs: Date.now() - handlerT0, path: "fast" }))
    return hot
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[Sigo] Telnyx webhook fields:", JSON.stringify(fields))
  }

  const calledNumberRaw = resolveCalledParty(fields)
  if (!pickField(fields, ["To", "to", "Called"]).trim() && calledNumberRaw) {
    console.log(
      JSON.stringify({
        zing: "telnyx-incoming-called-inferred",
        callSid: pickField(fields, ["CallSid", "CallControlId", "call_control_id"]) || null,
        inferredTo: calledNumberRaw,
        fieldKeySample: Object.keys(fields).slice(0, 25),
      })
    )
  }
  const callerNumber = pickField(fields, ["From", "from", "Caller", "caller", "RemoteParty"])
  const callSidRaw = pickField(fields, ["CallSid", "CallControlId", "call_control_id"])
  const callSid = callSidRaw.trim() || `zing-${randomUUID()}`
  if (!callSidRaw.trim()) {
    console.error(
      "[Sigo] Telnyx incoming missing CallSid/CallControlId — using synthetic id; confirm webhook fields in Telnyx portal."
    )
  }
  const callerName = pickField(fields, ["CallerName", "CallerIDName"]) || null

  const out = await handleIncomingCall(
    calledNumberRaw,
    callerNumber,
    callSid,
    callerName,
    Object.keys(fields),
    fields,
    inboundCtx
  )
  const body = texmlResponseBody(out)

  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml" },
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const fields = searchParamsToFields(url)
  const inboundCtx = inboundWebhookContext(req.url, fields)
  const hot = await tryFastInboundReceptionistResponse(fields, undefined, inboundCtx)
  if (hot) return hot

  const calledNumberRaw = resolveCalledParty(fields)
  if (!pickField(fields, ["To", "to", "Called"]).trim() && calledNumberRaw) {
    console.log(
      JSON.stringify({
        zing: "telnyx-incoming-called-inferred-get",
        callSid: pickField(fields, ["CallSid", "CallControlId", "call_control_id"]) || null,
        inferredTo: calledNumberRaw,
      })
    )
  }
  const callerNumber = pickField(fields, ["From", "from", "Caller", "caller", "RemoteParty"])
  const callSidRaw = pickField(fields, ["CallSid", "CallControlId", "call_control_id"])
  const callSid = callSidRaw.trim() || `zing-${randomUUID()}`
  if (!callSidRaw.trim()) {
    console.error("[Sigo] Telnyx incoming (GET) missing CallSid — using synthetic id.")
  }
  const callerName = pickField(fields, ["CallerName", "CallerIDName"]) || null

  const out = await handleIncomingCall(
    calledNumberRaw,
    callerNumber,
    callSid,
    callerName,
    Object.keys(fields),
    fields,
    inboundCtx
  )
  const body = texmlResponseBody(out)

  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml" },
  })
}
