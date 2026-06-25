// Platform-admin PSTN override — bypasses owner / receptionist / operator pool on inbound.

import { isReasonablePstnDialString } from "@/lib/db"
import {
  resolveCallerGreetingForDialPass,
  resolveWorkspaceDisplayName,
  shouldPlayCallerRingbackDuringDial,
  type InboundWorkspaceRoutingLike,
} from "@/lib/inbound-branded-greeting"
import { formatAdminRoutingOverridePhoneForTelnyx } from "@/lib/phone-e164"
import { buildReceptionistAnswerUrl } from "@/lib/receptionist-answer-url"
import {
  buildFastReceptionistDialTexml,
  resolveInboundForwardDialTimeoutSeconds,
} from "@/lib/telnyx-inbound-media-quality"
import {
  origFromQuerySuffixFromRaw,
  resolvePstnDialCallerIdForInboundForward,
} from "@/lib/telnyx-pstn-dial-callerid"

export type AdminRoutingOverrideRoutingLike = InboundWorkspaceRoutingLike & {
  user_id: string
  fallback_type?: string | null
  ring_timeout_seconds?: number | null
  admin_routing_override_phone?: string | null
}

export type AdminRoutingOverrideDialResult = { kind: "raw"; xml: string }

/** Normalize the admin override column to a Telnyx-ready E.164 (+ prefix), or null when unset/invalid. */
export function resolveAdminRoutingOverrideE164(
  routing: Pick<AdminRoutingOverrideRoutingLike, "admin_routing_override_phone">
): string | null {
  // Sanitize before TeXML `<Dial><Number>` — Telnyx rejects bare 10-digit strings without '+'.
  return formatAdminRoutingOverridePhoneForTelnyx(routing.admin_routing_override_phone)
}

/** Build TeXML that dials the admin override number, skipping standard routing evaluation. */
export function buildAdminRoutingOverrideDial(params: {
  routing: AdminRoutingOverrideRoutingLike
  businessLineE164: string
  callerNumber: string
  callSid: string
  appUrl: string
  callerName?: string | null
  greetingPassDone?: boolean
  resolveOutboundCallerId: (
    routing: AdminRoutingOverrideRoutingLike & { primary_phone_number?: string; active_phone_count?: number },
    businessLineE164: string
  ) => string
}): AdminRoutingOverrideDialResult | null {
  const overrideE164 = resolveAdminRoutingOverrideE164(params.routing)
  if (!overrideE164) return null

  const workspaceName = resolveWorkspaceDisplayName(params.routing)
  const callerGreeting = resolveCallerGreetingForDialPass(workspaceName, params.greetingPassDone ?? false)

  const wantsAiAfterNoAnswer = String(params.routing.fallback_type ?? "").toLowerCase() === "ai"
  const effectiveRingTimeout = Number(params.routing.ring_timeout_seconds ?? 30) || 30
  const dialTimeoutSec = resolveInboundForwardDialTimeoutSeconds(effectiveRingTimeout, wantsAiAfterNoAnswer)

  const didDigits = params.businessLineE164.replace(/\D/g, "")
  const fallbackMode = wantsAiAfterNoAnswer ? "owner-ai" : "owner"
  const fallbackPathBase =
    didDigits.length >= 10
      ? `${params.appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(params.routing.user_id)}/n/${didDigits}/${fallbackMode}`
      : `${params.appUrl}/api/voice/telnyx/fallback/u/${encodeURIComponent(params.routing.user_id)}`
  const modeQuery = didDigits.length < 10 ? `&zingFbMode=${encodeURIComponent(fallbackMode)}` : ""
  const fbQuery = wantsAiAfterNoAnswer ? "&fb=ai" : ""
  const bnQuery = `&bn=${encodeURIComponent(params.businessLineE164)}`
  const origFromQuery = origFromQuerySuffixFromRaw(params.callerNumber)
  const outboundCallerId = params.resolveOutboundCallerId(params.routing, params.businessLineE164)
  const pstnDialCallerE164 = resolvePstnDialCallerIdForInboundForward({
    inboundFromRaw: params.callerNumber,
    businessOutboundE164: outboundCallerId,
  })
  const action = `${fallbackPathBase}?callSid=${encodeURIComponent(params.callSid)}${bnQuery}${fbQuery}${modeQuery}&adminOverride=1&primary=owner&leg=owner-first${origFromQuery}`

  const answerUrl = buildReceptionistAnswerUrl({
    appUrl: params.appUrl,
    callSid: params.callSid,
    businessType: "generic",
    callerNumber: params.callerNumber.trim() || null,
    callerName: params.callerName ?? null,
    businessName: workspaceName,
  })

  const xml = buildFastReceptionistDialTexml({
    ...(isReasonablePstnDialString(pstnDialCallerE164) ? { callerId: pstnDialCallerE164 } : {}),
    answerOnBridge: true,
    timeout: dialTimeoutSec,
    action,
    receptionistE164: overrideE164,
    answerUrl,
    ...(callerGreeting ? { callerGreeting } : {}),
    includeRingback: shouldPlayCallerRingbackDuringDial(params.greetingPassDone ?? false),
  })

  return { kind: "raw", xml }
}
