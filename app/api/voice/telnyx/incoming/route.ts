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
import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { SITE_NAME } from "@/lib/brand"
import { texmlSayNatural } from "@/lib/texml-say-voice"
import { buildInboundLineWhisperPhrase } from "@/lib/inbound-line-whisper"
import { buildTelnyxDialFromDisplayName } from "@/lib/telnyx-caller-display"
import {
  getIncomingRoutingByNumber,
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
  readTelnyxDialAnswerOnBridge,
  resolvePstnDialCallerIdForInboundForward,
} from "@/lib/telnyx-pstn-dial-callerid"
import { shouldEmitVoiceHotPathDebugLogs } from "@/lib/voice-log-gate"
import {
  buildInboundEarlyMediaTexml,
  buildInboundPstnDialAttributes,
  buildInboundPstnNumberAttributes,
  buildInboundRoutingContinueUrl,
  finalizeInboundTexmlXml,
  readInboundEarlyMediaEnabled,
  readInboundRoutingCfgOverlayEnabled,
} from "@/lib/telnyx-inbound-media-quality"

export const runtime = "nodejs"
export const preferredRegion = "iad1"

// Warm Neon pool on cold start so the first real inbound call skips connection setup latency.
void warmDatabasePool()

/** Set to `0` / `false` / `no` to skip the short line-ID whisper on the callee leg. */
const INBOUND_RECEPTIONIST_WHISPER_DISABLED = ["0", "false", "no"].includes(
  (process.env.ZING_INBOUND_RECEPTIONIST_WHISPER || "").trim().toLowerCase()
)

function receptionistWhisperScreenUrl(phrase: string): string {
  return `${getAppUrl()}/api/voice/telnyx/receptionist-screen?p=${encodeURIComponent(phrase)}`
}

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

/** Pass 1 only — instant TeXML before DB routing (pass 2 sets `zingRoute=1` on the URL). */
function shouldServeEarlyMediaPass(url: URL, fields: Record<string, string>): boolean {
  if (!readInboundEarlyMediaEnabled()) return false
  if (url.searchParams.get("zingRoute") === "1") return false

  const dialOutcome = pickField(fields, [
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
    ["ringing", "ring", "queued", "init", "in-progress", "inprogress", "answered", "early-media", ""].includes(s)

  if (dialOutcome && !dialOutcomeIsNonLive(dialOutcome)) return false
  if (dialOutcome === "completed" && hasVoiceUrlDialCompletedEvidence(fields)) return false
  return true
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
    const formData = await req.formData()
    const out: Record<string, string> = {}
    formData.forEach((v, k) => {
      out[k] = String(v)
    })
    return out
  } catch {
    return {}
  }
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
 * Hot path: one routing row already has receptionist E.164 — return `<Dial>` immediately (no extra DB).
 * Skips the gap where US ringback plays to the caller before Telnyx starts the PSTN B-leg.
 */
function tryFastReceptionistDial(params: {
  routing: IncomingRoutingRowNonNull
  businessLineE164: string
  calledNumber: string
  callerNumber: string
  callSid: string
  callerName: string | null
  appUrl: string
}): IncomingCallResult | null {
  const { routing, businessLineE164, calledNumber, callerNumber, callSid, callerName, appUrl } = params
  const recPhone = resolveReceptionistDialE164(routing.receptionist_phone || "")
  if (!recPhone || !routing.selected_receptionist_id?.trim()) return null

  const wantsAiAfterNoAnswer = String(routing.fallback_type ?? "").toLowerCase() === "ai"
  const effectiveRingTimeout = Number(routing.ring_timeout_seconds ?? 30) || 30
  const receptionistRingSec = wantsAiAfterNoAnswer
    ? Math.min(effectiveRingTimeout, 22)
    : effectiveRingTimeout

  const didDigits = businessLineE164.replace(/\D/g, "")
  const fallbackMode = wantsAiAfterNoAnswer ? "recv-ai" : "recv"
  const fallbackPathBase =
    didDigits.length >= 10
      ? `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}/n/${didDigits}/${fallbackMode}`
      : `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(routing.user_id)}`
  const fbQuery = wantsAiAfterNoAnswer ? "&fb=ai" : ""
  const bnQuery = `&bn=${encodeURIComponent(businessLineE164)}`
  const origFromQuery = origFromQuerySuffixFromRaw(callerNumber)
  const outboundCallerId = resolveInboundOutboundCallerId(routing, businessLineE164)
  const pstnDialCallerE164 = resolvePstnDialCallerIdForInboundForward({
    inboundFromRaw: callerNumber,
    businessOutboundE164: outboundCallerId,
  })
  const answerOnBridge = readTelnyxDialAnswerOnBridge()

  const texml = new VoiceResponse()
  const dial = texml.dial(
    buildInboundPstnDialAttributes({
      ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
      answerOnBridge,
      timeout: receptionistRingSec,
      action: `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}${bnQuery}${fbQuery}${origFromQuery}`,
      method: "POST",
    }) as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0]
  )
  dial.number(buildInboundPstnNumberAttributes(), recPhone)

  void insertCallLog({
    user_id: routing.user_id,
    provider_call_sid: callSid,
    from_number: callerNumber.trim() ? normalizePhoneNumberE164(callerNumber) : "Unknown",
    to_number: businessLineE164 || normalizePhoneNumberE164(calledNumber),
    caller_name: callerName,
    call_type: "incoming",
    status: "ringing",
    duration_seconds: 0,
    routed_to_receptionist_id: routing.selected_receptionist_id,
    routed_to_name: routing.receptionist_name,
    has_recording: false,
    recording_url: null,
    recording_duration_seconds: null,
  }).catch((logErr) => {
    console.error("[Sigo] Call log insert failed (fast path):", logErr)
  })

  console.log(
    JSON.stringify({
      zing: "telnyx-incoming-fast-recv-dial",
      userId: routing.user_id,
      callSid,
      answerOnBridge,
    })
  )
  return { kind: "twiml", texml }
}

// Shared logic for routing a call (used by both POST and GET handlers)
async function handleIncomingCall(
  calledNumber: string,
  callerNumber: string,
  callSid: string,
  callerName: string | null,
  webhookFieldKeys: string[],
  webhookFields: Record<string, string>
): Promise<IncomingCallResult> {
  const texml = new VoiceResponse()
  const appUrl = getAppUrl()
  const debug = process.env.NODE_ENV !== "production"

  if (debug) console.log(`[Sigo] Incoming call: To=${calledNumber} From=${callerNumber} CallSid=${callSid}`)

  try {
    // E.164 for DB + fallback URL — must match phone_numbers.number (we also match by digits in SQL).
    const businessLineE164 = calledNumber ? normalizePhoneNumberE164(calledNumber) : ""

    // 1. One cached routing read — everything needed for `<Dial>` (receptionist, fallback, status, primary DID).
    const routing = await getIncomingRoutingByNumber(calledNumber)
    if (!routing) {
      console.error(
        "[Sigo] No user/routing for inbound — check phone_numbers row matches this line. Detail:",
        JSON.stringify({
          calledRaw: calledNumber,
          businessLineE164,
          digitKey: businessLineE164.replace(/\D/g, ""),
          callerRaw: callerNumber,
          callSid,
          webhookFieldKeys: webhookFieldKeys.slice(0, 40),
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

    const mightRepeatLeg = inboundWebhookLooksLikeDialRepeat(webhookFields)
    const overlayEnabled = readInboundRoutingCfgOverlayEnabled()

    if (!mightRepeatLeg && !overlayEnabled && routing.receptionist_phone?.trim()) {
      const fast = tryFastReceptionistDial({
        routing,
        businessLineE164,
        calledNumber,
        callerNumber,
        callSid,
        callerName,
        appUrl,
      })
      if (fast) return fast
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

    // 4. Log the incoming call (don't let logging failures break call routing)
    try {
      // Fire-and-forget so Telnyx doesn't wait for database writes.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      void insertCallLog({
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
      }).catch((logErr) => {
        console.error("[Sigo] Call log insert failed (continuing with routing):", logErr)
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

    // When the next step is Voice AI, cap ring time on the first leg so cell voicemail is less likely to answer the Dial.
    const receptionistRingSec = wantsAiAfterNoAnswer
      ? Math.min(effectiveRingTimeout || 20, 22)
      : effectiveRingTimeout || 20
    const ownerRingSec = wantsAiAfterNoAnswer
      ? Math.min(effectiveRingTimeout || 30, 22)
      : effectiveRingTimeout || 30

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
    const answerOnBridge = readTelnyxDialAnswerOnBridge()
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
    const whisperOffUser = routing.inbound_receptionist_whisper_enabled === false
    const whisperPhrase =
      INBOUND_RECEPTIONIST_WHISPER_DISABLED || whisperOffUser
        ? ""
        : buildInboundLineWhisperPhrase(
            routing.phone_line_label,
            routing.phone_line_friendly_name,
            businessLineE164
          )

    // Outbound CNAM hint: prefer **line label** when set (not default "Main Line"); else account business name.
    const lineLbl = routing.phone_line_label.trim()
    const fromDisplaySource =
      lineLbl && lineLbl.toLowerCase() !== "main line" ? lineLbl : routing.business_name
    const fromDisplayName = buildTelnyxDialFromDisplayName(fromDisplaySource)

    const pstnNumberAttrs = buildInboundPstnNumberAttributes()

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
        }) as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0]
      )
      dial.number(pstnNumberAttrs, recPhone)
    } else {
      const ownerPhone = normalizePhoneNumberE164(routing.owner_phone)
      if (debug) console.log(`[Sigo] No receptionist assigned, routing to owner: ${ownerPhone}`)
      const dial = texml.dial(
        buildInboundPstnDialAttributes({
          ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
          ...(fromDisplayName ? { fromDisplayName } : {}),
          answerOnBridge,
          timeout: ownerRingSec,
          action: `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}&primary=owner&leg=owner-first${bnQuery}${fbQuery}${modeQuery}${origFromQuery}`,
          method: "POST",
        }) as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0]
      )
      if (whisperPhrase.trim()) {
        dial.number({ ...pstnNumberAttrs, url: receptionistWhisperScreenUrl(whisperPhrase) }, ownerPhone)
      } else {
        dial.number(pstnNumberAttrs, ownerPhone)
      }
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

export async function POST(req: NextRequest) {
  const fields = await readWebhookFields(req)
  const reqUrl = new URL(req.url)
  if (shouldServeEarlyMediaPass(reqUrl, fields)) {
    const continueUrl = buildInboundRoutingContinueUrl(req.url)
    return new NextResponse(buildInboundEarlyMediaTexml(continueUrl), {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    })
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

  const out = await handleIncomingCall(calledNumberRaw, callerNumber, callSid, callerName, Object.keys(fields), fields)
  const body = texmlResponseBody(out)

  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml" },
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const fields = searchParamsToFields(url)
  if (shouldServeEarlyMediaPass(url, fields)) {
    const continueUrl = buildInboundRoutingContinueUrl(req.url)
    return new NextResponse(buildInboundEarlyMediaTexml(continueUrl), {
      headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
    })
  }
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

  const out = await handleIncomingCall(calledNumberRaw, callerNumber, callSid, callerName, Object.keys(fields), fields)
  const body = texmlResponseBody(out)

  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml" },
  })
}
