// Edge-safe instant pass-1 TeXML (no DB — global fallback only; per-line greeting uses /incoming + routing cache).

import {
  INBOUND_GREETING_PASS_PARAM,
  buildInboundGreetingContinueUrl,
  inboundGreetingPassDone,
} from "@/lib/inbound-greeting-param"

export { buildInboundGreetingContinueUrl, inboundGreetingPassDone }

/** Generic copy when pass 1 cannot read routing cache (speed > personalization). */
export const EDGE_GENERIC_GREETING_TEXT =
  "Thank you for calling. Please wait while we connect your call to a team member."

/** Standard Polly Neural on pass 1 — answers on Telnyx immediately (no HTTP fetch like `<Play>`). */
const EDGE_PASS1_SAY_VOICE = "Polly.Joanna-Neural"
const DEFAULT_SAY_LANGUAGE = "en-US"

export function isVoiceIncomingWebhookPath(pathname: string): boolean {
  return pathname === "/api/voice/telnyx/incoming" || pathname === "/api/voice/incoming"
}

export function edgeInboundGreetingPassDone(url: URL): boolean {
  return inboundGreetingPassDone(url.searchParams)
}

export function edgeInboundGreetingFirstEnabled(): boolean {
  const raw = (process.env.ZING_INBOUND_GREETING_FIRST || "1").trim().toLowerCase()
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off"
}

export function edgeInboundInstantGreetingAudioUrl(): string | null {
  const raw = (process.env.ZING_INBOUND_INSTANT_GREETING_AUDIO_URL || "").trim()
  return raw || null
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Pass-2 URL on `/incoming` with `lyncrGreet=1`. */
export function buildEdgeInboundGreetingContinueUrl(requestUrl: string): string {
  const url = new URL(requestUrl)
  url.pathname = "/api/voice/telnyx/incoming"
  url.searchParams.set(INBOUND_GREETING_PASS_PARAM, "1")
  url.searchParams.delete("zingGreet")
  return url.toString()
}

/** Pass 1 TeXML — instant `<Redirect>` only (answers the call with no ringback while Node boots pass 2). */
export function buildEdgeInstantGreetingTexml(continueUrl: string): string {
  const safeContinue = escapeXmlAttr(continueUrl)
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${safeContinue}</Redirect>
</Response>`
}

/** Legacy global intercept — instant redirect on pass 1 when Telnyx still POSTs to /incoming. */
export function shouldEdgeInstantGreetingIntercept(pathname: string, url: URL, method: string): boolean {
  if (!edgeInboundGreetingFirstEnabled()) return false
  if (!isVoiceIncomingWebhookPath(pathname)) return false
  if (method !== "POST" && method !== "GET") return false
  if (edgeInboundGreetingPassDone(url)) return false
  return true
}
