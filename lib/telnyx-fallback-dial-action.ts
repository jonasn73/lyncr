// ============================================
// Telnyx Dial `action` webhook — shared handler
// ============================================
// Used by /api/voice/telnyx/fallback and /api/voice/telnyx/fallback/u/[userId].
// Telnyx sometimes strips query params on Dial callbacks or uses GET — path userId + merged params fixes empty userId / wrong routing.

import { NextRequest, NextResponse } from "next/server"
import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import type { FallbackType, RoutingConfig, User } from "@/lib/types"
import {
  getRoutingConfig,
  getRoutingConfigForNumber,
  getIncomingRoutingByNumber,
  getUser,
  getPrimaryActiveBusinessNumberE164,
  updateCallLog,
  ensureCallLogForInboundLeg,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { normalizeTelnyxAssistantIdForTexml } from "@/lib/telnyx-ai-texml"
import { buildSayThenRedirectToAiBridgeTeXML } from "@/lib/telnyx-ai-handoff"
import { ensureTelnyxVoiceAiAssistant } from "@/lib/telnyx-ai-assistant-lifecycle"
import {
  maybeLogTelnyxFallbackDiagnostic,
  maybeLogTelnyxFallbackDiagnosticEntry,
  maybeLogTelnyxFallbackDiagnosticEarly,
} from "@/lib/telnyx-fallback-diagnostics"
import { texmlSayNatural } from "@/lib/texml-say-voice"
import { buildTelnyxDialFromDisplayName } from "@/lib/telnyx-caller-display"

/** Build FormData from a Telnyx Dial callback (POST body and/or GET query). */
async function getDialCallbackFormData(req: NextRequest): Promise<FormData> {
  const url = new URL(req.url)
  const method = req.method.toUpperCase()
  let body = new FormData()
  if (method === "GET") {
    url.searchParams.forEach((value, key) => {
      body.append(key, value)
    })
    return body
  }
  try {
    body = await req.formData()
  } catch {
    body = new FormData()
  }
  // Copy any query params missing from the POST body (Telnyx may split userId/callSid between URL and body).
  url.searchParams.forEach((value, key) => {
    if (!body.has(key)) body.append(key, value)
  })
  return body
}

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (phone.startsWith("+")) return phone
  return `+${digits}`
}

function normalizeFallbackType(v: string | undefined | null): FallbackType {
  const s = (v || "owner").toLowerCase().trim()
  if (s === "ai" || s === "voicemail" || s === "owner") return s
  return "owner"
}

function mergeFallbackType(
  resolvedConfig: RoutingConfig | null,
  liveFb: string | undefined | null,
  globalDefaultFb: string | undefined | null,
  useLive: boolean
): FallbackType {
  const hasSpecificNumberRow = Boolean(resolvedConfig?.business_number?.trim())
  const c = (resolvedConfig?.fallback_type || "").toLowerCase().trim()
  const l = useLive && liveFb ? String(liveFb).toLowerCase().trim() : ""
  const g = (globalDefaultFb || "").toLowerCase().trim()

  if (hasSpecificNumberRow) {
    if (c === "ai" || l === "ai") return "ai"
    if (c === "voicemail" || l === "voicemail") return "voicemail"
    if (c === "owner" || l === "owner") return "owner"
    return normalizeFallbackType(resolvedConfig?.fallback_type)
  }

  if (c === "ai" || l === "ai" || g === "ai") return "ai"
  if (c === "voicemail" || l === "voicemail" || g === "voicemail") return "voicemail"
  return normalizeFallbackType(resolvedConfig?.fallback_type ?? liveFb ?? globalDefaultFb)
}

/**
 * Public business DID for routing — **not** the party we just dialed on a Dial `action` callback.
 * Telnyx/TwiML often sets `To` / `DialCalledNumber` to the **owner cell** on that webhook; treating that as the DID
 * makes `getIncomingRoutingByNumber` fail or mismatch, so `fallback_type` can fall back to the **default row** (e.g. voicemail)
 * even when the line they called is set to **AI** in Zing.
 */
function resolveBusinessLineE164(bnFromQuery: string, formData: FormData): string {
  const q = bnFromQuery.trim()
  if (q) return toE164(q)
  const keys = [
    "OriginalCalledNumber",
    "OriginalCalled",
    "ForwardedFrom",
    "SipHeader_X-Telnyx-OriginalCalledNumber",
    "CallerDestination",
  ]
  for (const k of keys) {
    const raw = formData.get(k)
    const s = raw != null ? String(raw).trim() : ""
    if (s.replace(/\D/g, "").length >= 10) return toE164(s)
  }
  return ""
}

/**
 * Telnyx may drop `?primary=owner` on the Dial `action` URL. The callback still includes who was dialed (`To` / `DialCalledNumber`).
 * If that matches the owner’s cell, this was the “ring your phone first” leg — same as `primary=owner` for AI / voicemail logic.
 */
function inferDialLegWasOwnerCell(formData: FormData, ownerPhoneRaw: string | null | undefined): boolean {
  if (!ownerPhoneRaw?.trim()) return false
  const owner10 = normalizePhoneNumberE164(ownerPhoneRaw).replace(/\D/g, "").slice(-10)
  if (owner10.length < 10) return false
  const keys = [
    "To",
    "Called",
    "DialCalledNumber",
    "DialedNumber",
    "dialed_number",
    "called",
    "CallerDestination",
    "DialBridgedTo",
    "Destination",
  ]
  for (const k of keys) {
    const raw = formData.get(k)
    if (raw == null) continue
    const s = String(raw).trim()
    if (s.replace(/\D/g, "").length < 10) continue
    const to10 = normalizePhoneNumberE164(s).replace(/\D/g, "").slice(-10)
    if (to10 === owner10) return true
  }
  return false
}

function playTelnyxAiUnavailableVoicemail(
  texml: InstanceType<typeof VoiceResponse>,
  appUrl: string,
  userId: string,
  callSid: string
) {
  texmlSayNatural(
    texml,
    "Thanks for calling. Our voice assistant is not set up on this line yet. Please leave your name, phone number, and what you need after the tone and we will get back to you."
  )
  // Omit Twilio-only `transcribe` — Telnyx TeXML may not support it and can break `<Record>`.
  texml.record({
    maxLength: 120,
    recordingStatusCallback: `${appUrl}/api/voice/telnyx/recording-status`,
    action: `${appUrl}/api/voice/telnyx/voicemail-complete?userId=${userId}&callSid=${callSid}`,
  })
}

function parseDialDurationSeconds(formData: FormData): number {
  const raw =
    (formData.get("DialCallDuration") as string) ||
    (formData.get("DialCallDurationSeconds") as string) ||
    (formData.get("DialBridgedDuration") as string) ||
    (formData.get("CallDuration") as string) ||
    ""
  let n = parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 600) n = Math.round(n / 1000)
  return n
}

/** Longest digit run across Telnyx/TwiML Dial callback fields that may carry the bridged PSTN party (names vary by release). */
function dialCallbackBridgeDigitCount(formData: FormData): number {
  const keys = [
    "DialBridgedTo",
    "DialBridgedNumber",
    "BridgedTo",
    "BridgeTarget",
    "DialLegBridgedTo",
    "ConnectedParty",
  ]
  let max = 0
  for (const k of keys) {
    const d = String(formData.get(k) || "").replace(/\D/g, "").length
    if (d > max) max = d
  }
  return max
}

/** Resolve assistant id and return AI TeXML, or null to fall back to “AI unavailable” TeXML on the same VoiceResponse. */
async function tryBuildAiAssistantResponse(args: {
  userId: string
  user: User | null
  callSid: string
  dialStatus: string
  rawStatus: string
  answeredAndHadConversation: boolean
}): Promise<NextResponse | "missing-assistant" | null> {
  const { userId, user, callSid, dialStatus, rawStatus, answeredAndHadConversation } = args
  let assistantId =
    user?.telnyx_ai_assistant_id?.trim() || process.env.TELNYX_AI_ASSISTANT_ID?.trim() || ""
  if (!assistantId && userId) {
    const ensured = await ensureTelnyxVoiceAiAssistant(userId)
    if (ensured.linked && ensured.assistantId?.trim()) {
      assistantId = ensured.assistantId.trim()
    } else if (ensured.error) {
      console.log(
        JSON.stringify({
          zing: "telnyx-ai-ensure-failed",
          userId,
          error: ensured.error,
        })
      )
    }
  }
  if (assistantId) {
    const forTexml = normalizeTelnyxAssistantIdForTexml(assistantId)
    if (forTexml !== assistantId.trim()) {
      console.log(
        JSON.stringify({
          zing: "telnyx-ai-assistant-id-prefixed",
          reason: "TeXML expects assistant-{uuid}; API returned bare UUID",
        })
      )
    }
    if (callSid && !answeredAndHadConversation) {
      void updateCallLog(callSid, {
        call_type: "incoming",
        status: dialStatus || rawStatus || "ai-handoff",
      }).catch((e) => console.error("[Zing] Call log update (AI handoff):", e))
    }
    console.log(
      JSON.stringify({
        zing: "telnyx-ai-fallback",
        assistantIdLen: forTexml.length,
        texmlIdStartsWithAssistant: forTexml.toLowerCase().startsWith("assistant-"),
        handoff: "say-then-redirect-ai-bridge",
      })
    )
    return new NextResponse(buildSayThenRedirectToAiBridgeTeXML(userId, callSid || undefined), {
      headers: { "Content-Type": "text/xml" },
    })
  }
  return "missing-assistant"
}

/** Dial `action` URL path segment — survives Telnyx stripping long query strings. */
export type TelnyxFallbackPathMode = "recv" | "recv-ai" | "owner" | "owner-ai"

const TELNYX_FALLBACK_PATH_MODES = new Set<string>(["recv", "recv-ai", "owner", "owner-ai"])

export type TelnyxFallbackPathOpts = {
  /** Digits-only DID from `/fallback/u/{userId}/n/{did}/…` when query `bn` is missing or stripped. */
  pathDidDigits?: string
  /** recv / recv-ai / owner / owner-ai — AI intent is owner-ai & recv-ai even if `fb=ai` is dropped. */
  pathFallbackMode?: string
}

/**
 * @param pathUserId — from `/api/voice/telnyx/fallback/u/{userId}` when Telnyx drops `?userId=` on the Dial action URL.
 */
export async function handleTelnyxFallbackDialEnded(
  req: NextRequest,
  pathUserId: string | null,
  opts?: TelnyxFallbackPathOpts
): Promise<NextResponse> {
  const formData = await getDialCallbackFormData(req)
  const url = new URL(req.url)
  const pathDigits = (opts?.pathDidDigits || "").replace(/\D/g, "")
  const pathBnE164 = pathDigits.length >= 10 ? toE164(pathDigits) : ""
  const rawPathMode = (opts?.pathFallbackMode || "").trim().toLowerCase()
  const fromPathMode: TelnyxFallbackPathMode | undefined = TELNYX_FALLBACK_PATH_MODES.has(rawPathMode)
    ? (rawPathMode as TelnyxFallbackPathMode)
    : undefined
  const rawQueryMode = (
    url.searchParams.get("zingFbMode") ||
    String(formData.get("zingFbMode") || "")
  )
    .trim()
    .toLowerCase()
  const fromQueryMode: TelnyxFallbackPathMode | undefined = TELNYX_FALLBACK_PATH_MODES.has(rawQueryMode)
    ? (rawQueryMode as TelnyxFallbackPathMode)
    : undefined
  const pathFallbackMode = fromPathMode ?? fromQueryMode

  if (process.env.NODE_ENV !== "production") {
    const fields: Record<string, string> = {}
    formData.forEach((v, k) => {
      fields[k] = String(v)
    })
    console.log("[Zing] Telnyx fallback webhook:", JSON.stringify({ method: req.method, fields }))
  }

  const rawStatus =
    (formData.get("DialCallStatus") as string) ||
    (formData.get("DialCallLegStatus") as string) ||
    (formData.get("DialBridgeStatus") as string) ||
    (formData.get("CallStatus") as string) ||
    ""
  const dialStatus = rawStatus.trim().toLowerCase().replace(/_/g, "-")
  const dialDurationSec = parseDialDurationSeconds(formData)

  const callSid =
    (url.searchParams.get("callSid") || String(formData.get("CallSid") || formData.get("callSid") || "")).trim() ||
    ""
  let userId =
    (pathUserId?.trim() ||
      url.searchParams.get("userId") ||
      String(formData.get("userId") || "")).trim() || ""
  const bnFromQuery =
    (url.searchParams.get("bn") || String(formData.get("bn") || "")).trim() || ""
  const bnMergedForResolve = (bnFromQuery || pathBnE164).trim()
  const businessLineE164 = resolveBusinessLineE164(bnMergedForResolve, formData)
  /** Query flag from /incoming when the line uses AI after no-answer (may be stripped by carrier). */
  const inboundFbIntent = (url.searchParams.get("fb") || String(formData.get("fb") || "")).trim().toLowerCase()
  /** True if this call leg was configured for AI after no-answer (query and/or path mode). */
  const virtualFbAi =
    inboundFbIntent === "ai" ||
    pathFallbackMode === "owner-ai" ||
    pathFallbackMode === "recv-ai"
  /** Set after we load `user` — may add inference when `primary=owner` is missing from the callback URL. */
  const legHint =
    url.searchParams.get("leg")?.trim() || String(formData.get("leg") || "").trim()
  let primaryWasOwner =
    url.searchParams.get("primary") === "owner" ||
    String(formData.get("primary") || "").trim() === "owner" ||
    legHint === "owner-first" ||
    pathFallbackMode === "owner-ai" ||
    pathFallbackMode === "owner"
  const primaryOwnerFromParam = primaryWasOwner

  const texml = new VoiceResponse()
  const appUrl = getAppUrl()

  try {
    let effectiveBusinessLine = businessLineE164
    let lr =
      effectiveBusinessLine.length > 0
        ? await getIncomingRoutingByNumber(effectiveBusinessLine, { bypassCache: true })
        : null

    let userIdSource: "path" | "query-or-body" | "did-recovery" = pathUserId?.trim() ? "path" : "query-or-body"
    if (!userId && lr?.user_id) {
      userId = lr.user_id
      userIdSource = "did-recovery"
      console.log(JSON.stringify({ zing: "telnyx-fallback-userid-from-did", userId }))
    }

    if (userId && (!lr || lr.user_id !== userId)) {
      const primary = await getPrimaryActiveBusinessNumberE164(userId)
      if (primary) {
        const retry = await getIncomingRoutingByNumber(primary, { bypassCache: true })
        if (retry?.user_id === userId) {
          lr = retry
          effectiveBusinessLine = primary
        }
      }
    }

    if (!userId) {
      console.error(
        JSON.stringify({
          zing: "telnyx-fallback-missing-userid",
          pathUserId: pathUserId || null,
          toField: String(formData.get("To") || ""),
          callSid: callSid || null,
        })
      )
      maybeLogTelnyxFallbackDiagnosticEarly("missing-userid", {
        pathUserId: pathUserId || "",
        pathname: url.pathname,
        callSid,
      })
      texmlSayNatural(texml, "We're sorry, this call could not be completed. Please try again later.")
      texml.hangup()
      return new NextResponse(texml.toString(), {
        headers: { "Content-Type": "text/xml" },
      })
    }

    if (!primaryWasOwner && lr?.owner_phone) {
      if ((!userId || lr.user_id === userId) && inferDialLegWasOwnerCell(formData, lr.owner_phone)) {
        primaryWasOwner = true
        console.log(
          JSON.stringify({
            zing: "telnyx-fallback-primary-owner-inferred",
            userId,
            source: "routing_join_owner_phone",
          })
        )
      }
    }

    const bridgedToDigits = dialCallbackBridgeDigitCount(formData)
    maybeLogTelnyxFallbackDiagnosticEntry({
      pathname: url.pathname,
      method: req.method,
      pathUserId: pathUserId?.trim() || null,
      pathFallbackMode: pathFallbackMode ?? null,
      dialStatus,
      rawDialStatus: rawStatus,
      dialDurationSec,
      bridgedToDigits,
      callSid,
      virtualFbAi,
      primaryWasOwner,
      formData,
    })
    /** True when Telnyx reports the B-leg bridged to something that looks like a PSTN number (E.164 has enough digits). */
    const pstnBridgeEvidence = bridgedToDigits >= 10
    const primaryFromUrl =
      url.searchParams.get("primary") === "owner" ||
      String(formData.get("primary") || "").trim() === "owner" ||
      legHint === "owner-first"
    const receptionistCalleeMatches =
      Boolean(
        lr?.receptionist_phone?.trim() &&
          inferDialLegWasOwnerCell(formData, lr.receptionist_phone) &&
          !primaryFromUrl
      )
    /**
     * Receptionist leg ended after a real bridge — hang up the caller (no AI / voicemail on their leg).
     * Uses URL path `recv` / `recv-ai`, or when Telnyx strips the path, matches the dialed party to `receptionist_phone`
     * while **not** being the explicit “ring owner first” leg (`primary=owner` / `leg=owner-first`).
     */
    const receptionistLegEndedAfterBridge =
      (pathFallbackMode === "recv" || pathFallbackMode === "recv-ai" || receptionistCalleeMatches) &&
      dialStatus === "completed" &&
      pstnBridgeEvidence
    if (receptionistLegEndedAfterBridge) {
      maybeLogTelnyxFallbackDiagnosticEarly("recv-bridged-hangup", {
        dialDurationSec,
        bridgedToDigits,
        dialStatus,
        pathFallbackMode: pathFallbackMode ?? null,
      })
      texml.hangup()
      return new NextResponse(texml.toString(), {
        headers: { "Content-Type": "text/xml" },
      })
    }
    const answeredAndHadConversation =
      dialStatus === "completed" && dialDurationSec >= 120 && bridgedToDigits >= 10
    /**
     * `owner-ai` used to always hand the caller to Voice AI after the owner leg ended, even after a real conversation.
     * That is handled later with the same rule as receptionist: **completed + PSTN bridge** → hang up the A-leg (see below).
     * Keep skipping the generic 2‑minute “long bridged” hangup for `owner-ai` so we do not double‑end the call before that block runs.
     */
    const skipLongBridgedHangupForOwnerFirstAi = pathFallbackMode === "owner-ai"
    if (answeredAndHadConversation && !skipLongBridgedHangupForOwnerFirstAi) {
      maybeLogTelnyxFallbackDiagnosticEarly("long-bridged-hangup", {
        dialDurationSec,
        bridgedToDigits,
        dialStatus,
        pathFallbackMode: pathFallbackMode ?? null,
      })
      texml.hangup()
      return new NextResponse(texml.toString(), {
        headers: { "Content-Type": "text/xml" },
      })
    }

    const [config, globalDefaultConfig, user] = await Promise.all([
      effectiveBusinessLine
        ? getRoutingConfigForNumber(userId, effectiveBusinessLine)
        : getRoutingConfig(userId),
      getRoutingConfig(userId),
      getUser(userId),
    ])

    if (!primaryWasOwner && inferDialLegWasOwnerCell(formData, user?.phone)) {
      primaryWasOwner = true
      console.log(
        JSON.stringify({
          zing: "telnyx-fallback-primary-owner-inferred",
          userId,
          source: "users_phone_column",
        })
      )
    }

    const useLive = Boolean(lr && lr.user_id === userId)
    let fallbackType = mergeFallbackType(config, lr?.fallback_type, globalDefaultConfig?.fallback_type, useLive)

    if (primaryWasOwner && fallbackType === "owner") {
      const accountWantsAi =
        globalDefaultConfig?.fallback_type === "ai" || (useLive && lr?.fallback_type === "ai")
      if (accountWantsAi || pathFallbackMode === "owner-ai") {
        fallbackType = "ai"
        console.log(
          JSON.stringify({
            zing: "telnyx-fallback-promote-ai-after-owner-leg",
            userId,
            reason: pathFallbackMode === "owner-ai" ? "path-mode-owner-ai" : "account-or-live-default-says-ai",
          })
        )
      }
    }

    // Only override merged voicemail → AI when no routing row we trust says voicemail (avoids TeXML path `owner-ai` + stripped `bn` fighting the dashboard).
    if (
      virtualFbAi &&
      fallbackType === "voicemail" &&
      (primaryWasOwner || legHint === "owner-first" || pathFallbackMode === "owner-ai")
    ) {
      const liveVoicemail = useLive && lr?.fallback_type === "voicemail"
      const perNumberVoicemail = config?.fallback_type === "voicemail"
      const globalVoicemail = globalDefaultConfig?.fallback_type === "voicemail"
      if (!liveVoicemail && !perNumberVoicemail && !globalVoicemail) {
        fallbackType = "ai"
        console.log(
          JSON.stringify({
            zing: "telnyx-fallback-fb-ai-overrides-voicemail",
            userId,
            pathBnPresent: Boolean(pathBnE164),
            pathFallbackMode: pathFallbackMode ?? null,
          })
        )
      }
    }

    if (useLive && lr && config?.fallback_type && config.fallback_type !== lr.fallback_type) {
      console.log(
        JSON.stringify({
          zing: "telnyx-fallback-routing-mismatch",
          userId,
          businessLineE164: businessLineE164 || null,
          effectiveBusinessLine: effectiveBusinessLine || null,
          fromIncomingJoin: lr.fallback_type,
          fromConfigQuery: config.fallback_type,
          mergedFallback: fallbackType,
        })
      )
    }

    console.log(
      JSON.stringify({
        zing: "telnyx-fallback",
        userIdSource,
        userId,
        businessLineE164: businessLineE164 || null,
        effectiveBusinessLine: effectiveBusinessLine || null,
        hadBnQuery: Boolean(bnFromQuery),
        pathBnE164: pathBnE164 || null,
        pathFallbackMode: pathFallbackMode ?? null,
        inboundFbIntent: inboundFbIntent || null,
        virtualFbAi,
        dialBridgedToDigits: bridgedToDigits,
        httpMethod: req.method,
        toField: String(formData.get("To") || ""),
        fallbackFromConfig: config?.fallback_type ?? null,
        fallbackFromGlobalDefault: globalDefaultConfig?.fallback_type ?? null,
        resolvedRoutingIsPerNumber: Boolean(config?.business_number?.trim()),
        fallbackFromLiveJoin: useLive ? lr?.fallback_type ?? null : null,
        fallbackType,
        primaryWasOwner,
        primaryOwnerFromParam,
        primaryOwnerInferred: primaryWasOwner && !primaryOwnerFromParam,
        legHint: legHint || null,
        dialDurationSec,
        hasTelnyxAiAssistant: Boolean(user?.telnyx_ai_assistant_id?.trim()),
        dialStatus: dialStatus || rawStatus || null,
      })
    )

    maybeLogTelnyxFallbackDiagnostic({
      requestUrl: url.toString(),
      method: req.method,
      formData,
      snapshot: {
        userId,
        callSid,
        dialStatus,
        rawDialStatus: rawStatus,
        dialDurationSec,
        bridgedToDigits,
        answeredAndHadConversation,
        pathFallbackMode: pathFallbackMode ?? null,
        virtualFbAi,
        inboundFbIntent,
        primaryWasOwner,
        legHint,
        businessLineResolved: businessLineE164,
        effectiveBusinessLine,
        fallbackType,
        useLive,
        liveFallbackType: useLive ? lr?.fallback_type ?? null : null,
        configFallbackType: config?.fallback_type ?? null,
        globalFallbackType: globalDefaultConfig?.fallback_type ?? null,
        hasAssistantId: Boolean(user?.telnyx_ai_assistant_id?.trim()),
      },
    })

    const fromDial =
      String(formData.get("From") || formData.get("Caller") || formData.get("RemoteParty") || "").trim() ||
      "Unknown"
    const toDial =
      effectiveBusinessLine ||
      businessLineE164 ||
      resolveBusinessLineE164(bnFromQuery, formData) ||
      String(formData.get("To") || formData.get("Called") || "").trim()
    if (userId && callSid) {
      void ensureCallLogForInboundLeg({
        userId,
        providerCallSid: callSid,
        fromNumber: fromDial === "Unknown" ? fromDial : normalizePhoneNumberE164(fromDial),
        toNumber: toDial ? normalizePhoneNumberE164(toDial) : "Unknown",
        routedToReceptionistId: lr && lr.user_id === userId ? lr.selected_receptionist_id : null,
      }).catch((err) => console.error("[Zing] ensureCallLogForInboundLeg failed:", err))
    }

    /**
     * Owner cell leg (`owner` / `owner-ai`, or stripped path) ended after a real PSTN bridge — end the caller’s leg.
     * Do not require `pathFallbackMode` in the URL (Telnyx often truncates `/n/{did}/{mode}`); exclude receptionist legs.
     */
    const recvLegByPath = pathFallbackMode === "recv" || pathFallbackMode === "recv-ai"
    const ownerFirstLegBridgedComplete =
      primaryWasOwner &&
      !recvLegByPath &&
      !receptionistCalleeMatches &&
      dialStatus === "completed" &&
      pstnBridgeEvidence
    if (ownerFirstLegBridgedComplete) {
      maybeLogTelnyxFallbackDiagnosticEarly("owner-first-leg-bridged-hangup", {
        dialDurationSec,
        bridgedToDigits,
        dialStatus,
        pathFallbackMode: pathFallbackMode ?? null,
        primaryWasOwner,
      })
      texml.hangup()
      return new NextResponse(texml.toString(), {
        headers: { "Content-Type": "text/xml" },
      })
    }

    switch (fallbackType) {
      case "owner": {
        if (primaryWasOwner) {
          // After your cell leg: offer Voice AI only when routing explicitly asks for AI (not merely because an assistant id exists — that broke “ring phone then voicemail” lines).
          const wantAiHandoff =
            (virtualFbAi && primaryWasOwner) ||
            globalDefaultConfig?.fallback_type === "ai" ||
            (useLive && lr?.fallback_type === "ai")
          if (wantAiHandoff) {
            const aiRes = await tryBuildAiAssistantResponse({
              userId,
              user,
              callSid,
              dialStatus,
              rawStatus,
              answeredAndHadConversation,
            })
            if (aiRes && aiRes !== "missing-assistant") return aiRes
            if (aiRes === "missing-assistant") {
              console.log(
                JSON.stringify({
                  zing: "telnyx-ai-fallback-no-assistant",
                  userId,
                  context: "primary-owner-leg",
                  dialStatus: dialStatus || rawStatus || null,
                })
              )
              playTelnyxAiUnavailableVoicemail(texml, appUrl, userId, callSid)
              break
            }
          }
          const greeting =
            config?.ai_greeting?.trim() || "Sorry we could not reach you. Please leave a message after the tone."
          texmlSayNatural(texml, greeting)
          texml.record({
            maxLength: 120,
            recordingStatusCallback: `${appUrl}/api/voice/telnyx/recording-status`,
            action: `${appUrl}/api/voice/telnyx/voicemail-complete?userId=${userId}&callSid=${callSid}`,
          })
          break
        }
        if (user) {
          const bnForAction =
            (bnFromQuery || "").trim() ||
            effectiveBusinessLine ||
            businessLineE164 ||
            (await getPrimaryActiveBusinessNumberE164(userId)) ||
            ""
          // Must be a Telnyx-owned business DID — not `To` from this webhook (often the callee’s cell), or carriers may flag spam / fail attestation.
          const outboundCallerId = bnForAction.trim() ? normalizePhoneNumberE164(bnForAction) : undefined
          const fromDisplayName = buildTelnyxDialFromDisplayName(user?.business_name)
          const didPath = bnForAction.replace(/\D/g, "")
          const secondMode: TelnyxFallbackPathMode =
            (useLive && lr?.fallback_type === "ai") || globalDefaultConfig?.fallback_type === "ai"
              ? "owner-ai"
              : "owner"
          const fbTail =
            secondMode === "owner-ai" ? "&fb=ai" : ""
          const secondLegBase =
            didPath.length >= 10
              ? `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(userId)}/n/${didPath}/${secondMode}`
              : `${appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(userId)}`
          const secondModeQuery = didPath.length < 10 ? `&zingFbMode=${encodeURIComponent(secondMode)}` : ""
          const dial = texml.dial({
            callerId: outboundCallerId,
            ...(fromDisplayName ? { fromDisplayName } : {}),
            answerOnBridge: true,
            timeout: 30,
            action: `${secondLegBase}?callSid=${encodeURIComponent(callSid)}&primary=owner&leg=owner-first&bn=${encodeURIComponent(bnForAction)}${fbTail}${secondModeQuery}`,
            method: "POST",
          } as Parameters<InstanceType<typeof VoiceResponse>["dial"]>[0])
          dial.number(toE164(user.phone))
        } else {
          texmlSayNatural(texml, "We're sorry, no one is available. Please leave a message after the beep.")
          texml.record({
            maxLength: 120,
            recordingStatusCallback: `${appUrl}/api/voice/telnyx/recording-status`,
          })
        }
        break
      }

      case "ai": {
        const aiRes = await tryBuildAiAssistantResponse({
          userId,
          user,
          callSid,
          dialStatus,
          rawStatus,
          answeredAndHadConversation,
        })
        if (aiRes && aiRes !== "missing-assistant") return aiRes
        console.log(
          JSON.stringify({
            zing: "telnyx-ai-fallback-no-assistant",
            userId,
            dialStatus: dialStatus || rawStatus || null,
          })
        )
        playTelnyxAiUnavailableVoicemail(texml, appUrl, userId, callSid)
        break
      }

      case "voicemail": {
        const greeting = config?.ai_greeting || "Please leave a message after the beep."
        texmlSayNatural(texml, greeting)
        texml.record({
          maxLength: 120,
          recordingStatusCallback: `${appUrl}/api/voice/telnyx/recording-status`,
          action: `${appUrl}/api/voice/telnyx/voicemail-complete?userId=${userId}&callSid=${callSid}`,
        })
        break
      }

      default: {
        texmlSayNatural(texml, "We're sorry, no one is available right now. Goodbye.")
        texml.hangup()
      }
    }

    if (callSid && !answeredAndHadConversation) {
      void updateCallLog(callSid, {
        call_type: fallbackType === "voicemail" ? "voicemail" : "incoming",
        status: dialStatus || rawStatus || "unknown",
      }).catch((logErr) => {
        console.error("[Zing] Call log update failed (continuing):", logErr)
      })
    }
  } catch (error) {
    console.error("[Telnyx] Error in fallback webhook:", error)
    texmlSayNatural(texml, "We're sorry, there was an error. Please try again later.")
    texml.hangup()
  }

  return new NextResponse(texml.toString(), {
    headers: { "Content-Type": "text/xml" },
  })
}
