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
import { texmlSayNatural } from "@/lib/texml-say-voice"
import { buildInboundLineWhisperPhrase } from "@/lib/inbound-line-whisper"
import { buildTelnyxDialFromDisplayName } from "@/lib/telnyx-caller-display"
import {
  getIncomingRoutingByNumber,
  getReceptionist,
  getRoutingConfigForNumber,
  getPhoneNumbers,
  getUser,
  insertCallLog,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
  bumpTelnyxAiIncomingHitCount,
  isTelnyxInboundDialCallerLegDone,
  markTelnyxInboundDialCallerLegDone,
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

export const runtime = "nodejs"
export const preferredRegion = "iad1"

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

/** Only treat “Dial completed” on the voice URL as terminal when Telnyx sent real dial metadata (avoids hanging up before the first `<Dial>`). */
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

  if (debug) console.log(`[Zing] Incoming call: To=${calledNumber} From=${callerNumber} CallSid=${callSid}`)

  try {
    // E.164 for DB + fallback URL — must match phone_numbers.number (we also match by digits in SQL).
    const businessLineE164 = calledNumber ? normalizePhoneNumberE164(calledNumber) : ""

    // 1. Resolve owner + per-number routing + receptionist in one DB query.
    const routing = await getIncomingRoutingByNumber(calledNumber, { bypassCache: true })
    if (!routing) {
      console.error(
        "[Zing] No user/routing for inbound — check phone_numbers row matches this line. Detail:",
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

    if (debug) console.log(`[Zing] Found user ${routing.user_id} (${routing.user_name}) for number ${calledNumber}`)
    if (debug) console.log(`[Zing] Routing config: receptionist=${routing.selected_receptionist_id || "none"}, fallback=${routing.fallback_type || "owner"}`)

    if (await isTelnyxInboundDialCallerLegDone(callSid)) {
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

    // 3. Per-DID routing must match the dashboard (GET /api/routing?number=…): one `getRoutingConfigForNumber` read drives
    // selected receptionist, fallback (AI vs not), and ring timeout — the SQL join row can disagree after edits.
    const cfgDid = businessLineE164 || normalizePhoneNumberE164(calledNumber) || calledNumber.trim()
    let routingCfg: RoutingConfig | null = null
    try {
      routingCfg = await getRoutingConfigForNumber(routing.user_id, cfgDid)
    } catch (cfgErr) {
      console.error("[Zing] getRoutingConfigForNumber on incoming failed (using SQL join only):", cfgErr)
    }

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
      const rec = await getReceptionist(selectedReceptionistId)
      const recOk = Boolean(rec && String(rec.user_id) === String(routing.user_id))
      if (recOk && rec) {
        receptionistDisplayName = rec.name ?? receptionistDisplayName
        if (rec.phone?.trim()) {
          const fromRow = normalizePhoneNumberE164(rec.phone)
          if (fromRow && isReasonablePstnDialString(fromRow)) {
            receptionistDialE164 = fromRow
          }
          if (!receptionistDialE164) {
            const digits = rec.phone.replace(/\D/g, "")
            if (digits.length === 10) receptionistDialE164 = `+1${digits}`
            else if (digits.length === 11 && digits.startsWith("1")) receptionistDialE164 = `+${digits}`
            else if (digits.length >= 10 && digits.length <= 15) receptionistDialE164 = `+${digits}`
            if (receptionistDialE164) {
              console.log(
                JSON.stringify({
                  zing: "telnyx-incoming-receptionist-phone-relaxed-digits",
                  userId: routing.user_id,
                  receptionistId: selectedReceptionistId,
                  callSid,
                })
              )
            }
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
        console.error("[Zing] Call log insert failed (continuing with routing):", logErr)
      })
    } catch (logErr) {
      console.error("[Zing] Call log insert failed (continuing with routing):", logErr)
    }

    // 5. Route: receptionist (per-number or default) → owner's cell as fallback
    // Outbound PSTN leg: callerId must be set — use normalized business DID so the callee can see which number was dialed.
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
              : `Last-resort <Connect> on /incoming is off. When incomingHitCount > ${SILENT_INCOMING_LOOP_CAP} we play Zing give-up (not Telnyx error). Set ZING_AI_LAST_RESORT_CONNECT_HIT=N to try Connect on hit N.`,
          })
        )
        return { kind: "raw", xml } // Bypass VoiceResponse builder because helpers return full XML strings
      }
      console.warn(
        "[Zing] AI direct path skipped — no assistant id; falling back to <Dial> owner + /fallback webhook."
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
    const phoneList = await getPhoneNumbers(routing.user_id)
    const primaryRow = phoneList.find((p) => p.status === "active") ?? phoneList[0]
    const primaryE164 = primaryRow?.number?.trim() ? normalizePhoneNumberE164(primaryRow.number) : ""
    const multiLine = phoneList.filter((p) => p.status === "active").length >= 2

    let outboundCallerId = businessLineE164
    if (preferPrimaryCallerId) {
      if (primaryE164 && isReasonablePstnDialString(primaryE164)) {
        outboundCallerId = primaryE164
        console.log(
          JSON.stringify({
            zing: "telnyx-incoming-callerid-forced-primary-env",
            callSid,
            userId: routing.user_id,
            dialedLine: businessLineE164 || null,
            callerIdUsed: outboundCallerId,
          })
        )
      }
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
      if (primaryE164 && isReasonablePstnDialString(primaryE164)) {
        outboundCallerId = primaryE164
        console.log(
          JSON.stringify({
            zing: "telnyx-incoming-callerid-fallback-primary",
            callSid,
            userId: routing.user_id,
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

    // callerId on the outbound PSTN leg is the business DID so the callee’s phone can show which line was dialed.
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

    if (hasReceptionist) {
      const recPhone = receptionistDialE164
      if (debug) console.log(`[Zing] Routing to receptionist: ${receptionistDisplayName || "Receptionist"} (${recPhone})`)
      // Receptionist leg: omit `fromDisplayName` — Telnyx often fails or drops the PSTN B-leg when CNAM + forwarded mobile combine.
      const dial = texml.dial({
        ...(isReasonablePstnDialString(outboundCallerId) ? { callerId: outboundCallerId } : {}),
        answerOnBridge: true,
        timeout: receptionistRingSec,
        action: `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}${bnQuery}${fbQuery}`,
        method: "POST",
      } as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0])
      dial.number(recPhone)
    } else {
      const ownerPhone = normalizePhoneNumberE164(routing.owner_phone)
      if (debug) console.log(`[Zing] No receptionist assigned, routing to owner: ${ownerPhone}`)
      // Same as receptionist path: if your phone does not answer, POST to fallback so AI / voicemail / second leg can run.
      const dial = texml.dial({
        ...(isReasonablePstnDialString(outboundCallerId) ? { callerId: outboundCallerId } : {}),
        ...(fromDisplayName ? { fromDisplayName } : {}),
        answerOnBridge: true,
        timeout: ownerRingSec,
        action: `${fallbackPathBase}?callSid=${encodeURIComponent(callSid)}&primary=owner&leg=owner-first${bnQuery}${fbQuery}${modeQuery}`,
        method: "POST",
      } as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0])
      if (whisperPhrase.trim()) {
        dial.number({ url: receptionistWhisperScreenUrl(whisperPhrase) }, ownerPhone)
      } else {
        dial.number(ownerPhone)
      }
    }
  } catch (error) {
    console.error("[Telnyx] Error in incoming webhook:", error)
    texmlSayNatural(texml, "We're sorry, there was an error connecting your call. Please try again later.")
    texml.hangup()
  }

  if (debug) console.log(`[Zing] TeXML response: ${texml.toString().slice(0, 500)}`)
  return { kind: "twiml", texml }
}

export async function POST(req: NextRequest) {
  const fields = await readWebhookFields(req)
  if (process.env.NODE_ENV !== "production") {
    console.log("[Zing] Telnyx webhook fields:", JSON.stringify(fields))
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
      "[Zing] Telnyx incoming missing CallSid/CallControlId — using synthetic id; confirm webhook fields in Telnyx portal."
    )
  }
  const callerName = pickField(fields, ["CallerName", "CallerIDName"]) || null

  const out = await handleIncomingCall(calledNumberRaw, callerNumber, callSid, callerName, Object.keys(fields), fields)
  const body = out.kind === "raw" ? out.xml : out.texml.toString()

  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml" },
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const fields = searchParamsToFields(url)
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
    console.error("[Zing] Telnyx incoming (GET) missing CallSid — using synthetic id.")
  }
  const callerName = pickField(fields, ["CallerName", "CallerIDName"]) || null

  const out = await handleIncomingCall(calledNumberRaw, callerNumber, callSid, callerName, Object.keys(fields), fields)
  const body = out.kind === "raw" ? out.xml : out.texml.toString()

  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml" },
  })
}
