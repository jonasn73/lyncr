// Branded inbound caller greeting — workspace name from the dialed line's organization context.

import { getTexmlSayVoiceAttributes, texmlSayMessageBody } from "@/lib/texml-say-voice"
import { escapeXmlAttr } from "@/lib/telnyx-inbound-media-quality"
import { readTelnyxDialAnswerOnBridge } from "@/lib/telnyx-pstn-dial-callerid"
import {
  buildInboundGreetingContinueUrl,
  inboundGreetingPassDone,
} from "@/lib/inbound-greeting-param"

export { buildInboundGreetingContinueUrl, inboundGreetingPassDone }

/** Routing row fields used to pick the speakable workspace / brand label. */
export type InboundWorkspaceRoutingLike = {
  organization_name?: string | null
  phone_line_label?: string | null
  business_name?: string | null
}

/** Prefer workspace (organization) name, then non-default line label, then account business name. */
export function resolveWorkspaceDisplayName(routing: InboundWorkspaceRoutingLike): string {
  const org = routing.organization_name?.trim()
  if (org) return org
  const lbl = routing.phone_line_label?.trim() ?? ""
  if (lbl && lbl.toLowerCase() !== "main line") return lbl
  const biz = routing.business_name?.trim()
  if (biz) return biz
  return "our business"
}

/** Caller-facing phrase played before we `<Dial>` the technician / owner leg. */
export function buildInboundCallerGreetingText(workspaceName: string): string {
  const name = workspaceName.trim() || "our business"
  return `Thank you for calling ${name}. Please wait while we connect your call to a team member.`
}

/** Zero-DB pass 1 when routing cache is cold — avoids Neon latency while the caller still hears ringback. */
export const INBOUND_GENERIC_CALLER_GREETING =
  "Thank you for calling. Please wait while we connect your call to a team member."

/** Optional hosted WAV/MP3 for pass 1 — plays faster than TTS while Telnyx is still fetching pass 2. */
export function readInboundInstantGreetingAudioUrl(): string | null {
  const raw = (process.env.ZING_INBOUND_INSTANT_GREETING_AUDIO_URL || "").trim()
  return raw || null
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Raw TeXML `<Say>` tag with neural Polly voice (matches `texmlSayNatural`). */
export function buildTexmlCallerGreetingSayTag(plainGreeting: string): string {
  const attrs = getTexmlSayVoiceAttributes()
  const body = texmlSayMessageBody(plainGreeting)
  const content = body.startsWith("<prosody") ? body : escapeXmlText(body)
  return `<Say voice="${escapeXmlAttr(attrs.voice)}" language="${escapeXmlAttr(attrs.language)}">${content}</Say>`
}

/** Prepend a branded `<Say>` immediately after the opening `<Response>` tag. */
export function prependInboundCallerGreetingToResponseTexml(texmlXml: string, greetingText: string): string {
  const say = buildTexmlCallerGreetingSayTag(greetingText)
  if (texmlXml.includes("<Response>")) {
    return texmlXml.replace("<Response>", `<Response>\n  ${say}`)
  }
  if (texmlXml.includes("<Response ")) {
    return texmlXml.replace(/<Response\s[^>]*>/, (open) => `${open}\n  ${say}`)
  }
  return texmlXml
}

/**
 * Two-pass inbound greeting (default on): pass 1 plays `<Say>` then `<Redirect>` before any `<Dial>`.
 * Stops US ringback from overlapping the branded greeting. Disable with `ZING_INBOUND_GREETING_FIRST=0`.
 */
export function readInboundGreetingFirstPassEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_GREETING_FIRST || "1").trim().toLowerCase()
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off"
}

/** Per-line dashboard toggle (defaults true when column missing). */
export function isInboundCallerGreetingEnabled(
  routing: { inbound_caller_greeting_enabled?: boolean } | null | undefined
): boolean {
  if (!readInboundGreetingFirstPassEnabled()) return false
  if (!routing) return true
  return routing.inbound_caller_greeting_enabled !== false
}

/** Pass 1 TeXML — speak the greeting, then redirect to routing pass 2 (no `<Dial>` yet). */
export function buildInboundCallerGreetingOnlyTexml(greetingText: string, continueUrl: string): string {
  const audioUrl = readInboundInstantGreetingAudioUrl()
  const safeUrl = escapeXmlAttr(continueUrl)
  if (audioUrl) {
    const safeAudio = escapeXmlAttr(audioUrl)
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${safeAudio}</Play>
  <Redirect method="POST">${safeUrl}</Redirect>
</Response>`
  }
  const say = buildTexmlCallerGreetingSayTag(greetingText.trim())
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say}
  <Redirect method="POST">${safeUrl}</Redirect>
</Response>`
}

let cachedGenericGreetingSayTag: string | null = null

function genericGreetingSayTag(): string {
  cachedGenericGreetingSayTag ??= buildTexmlCallerGreetingSayTag(INBOUND_GENERIC_CALLER_GREETING)
  return cachedGenericGreetingSayTag
}

/** Fastest pass 1 — prebuilt `<Say>` (or optional `<Play>`) with no routing DB lookup. */
export function buildInstantGenericGreetingFirstPassResult(incomingUrl: string): { kind: "raw"; xml: string } {
  const continueUrl = buildInboundGreetingContinueUrl(incomingUrl)
  const audioUrl = readInboundInstantGreetingAudioUrl()
  if (audioUrl) {
    return {
      kind: "raw",
      xml: buildInboundCallerGreetingOnlyTexml(INBOUND_GENERIC_CALLER_GREETING, continueUrl),
    }
  }
  const safeUrl = escapeXmlAttr(continueUrl)
  return {
    kind: "raw",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${genericGreetingSayTag()}
  <Redirect method="POST">${safeUrl}</Redirect>
</Response>`,
  }
}

/** Branded `<Say>` on the same response as `<Dial>` — only when two-pass greeting is disabled. */
export function resolveCallerGreetingForDialPass(
  workspaceName: string,
  greetingPassDone: boolean,
  greetingEnabled = true
): string | undefined {
  if (greetingPassDone) return undefined
  if (readInboundGreetingFirstPassEnabled() && greetingEnabled) return undefined
  if (!greetingEnabled) return undefined
  if (!readInboundGreetingFirstPassEnabled()) return buildInboundCallerGreetingText(workspaceName)
  return undefined
}

/** Pass 1 result when two-pass greeting is enabled and greeting has not played yet. */
export function buildInboundGreetingFirstPassResult(
  routing: InboundWorkspaceRoutingLike,
  incomingUrl: string
): { kind: "raw"; xml: string } {
  const workspaceName = resolveWorkspaceDisplayName(routing)
  const greeting = buildInboundCallerGreetingText(workspaceName)
  const continueUrl = buildInboundGreetingContinueUrl(incomingUrl)
  return { kind: "raw", xml: buildInboundCallerGreetingOnlyTexml(greeting, continueUrl) }
}

export function shouldPlayInboundGreetingFirstPass(greetingPassDone: boolean, greetingEnabled = true): boolean {
  return !greetingPassDone && greetingEnabled && readInboundGreetingFirstPassEnabled()
}

/** When false (default), callers hear silence — not US ringback — while the team phone rings after the greeting. */
export function readInboundCallerRingbackAfterGreetingEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_RINGBACK_AFTER_GREETING || "0").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

/** Greeting off → straight ringback. Greeting on → silence after message while cell rings (unless env override). */
export function shouldPlayCallerRingbackDuringDial(
  greetingPassDone: boolean,
  greetingEnabled = true
): boolean {
  if (!greetingEnabled || !readInboundGreetingFirstPassEnabled()) return true
  if (!greetingPassDone) return false
  return readInboundCallerRingbackAfterGreetingEnabled()
}

/** PSTN cell forward — ringback only when caller greeting is disabled (straight ring mode). */
export function resolveInboundPstnForwardAnswerOnBridge(
  greetingPassDone: boolean,
  greetingEnabled = true
): boolean {
  if (!greetingEnabled || !readInboundGreetingFirstPassEnabled()) return readTelnyxDialAnswerOnBridge()
  if (greetingPassDone) return false
  return readTelnyxDialAnswerOnBridge()
}
