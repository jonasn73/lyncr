// Edge-safe instant pass-1 TeXML (no DB, no Twilio SDK — runs in middleware before Node cold start).

/** Generic copy when pass 1 cannot read routing cache (speed > personalization). */
export const EDGE_GENERIC_GREETING_TEXT =
  "Thank you for calling. Please wait while we connect your call to a team member."

/** Pre-recorded greeting WAV in /public — `<Play>` starts faster than neural `<Say>` TTS. */
export const INBOUND_GENERIC_GREETING_AUDIO_PATH = "/audio/inbound-generic-greeting.wav"

const DEFAULT_SAY_VOICE = "Polly.Joanna-Neural"
const DEFAULT_SAY_LANGUAGE = "en-US"

export function isVoiceIncomingWebhookPath(pathname: string): boolean {
  return pathname === "/api/voice/telnyx/incoming" || pathname === "/api/voice/incoming"
}

export function edgeInboundGreetingPassDone(url: URL): boolean {
  const v = url.searchParams.get("zingGreet")?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
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

/** Pass-2 URL on `/incoming` with `zingGreet=1` (Telnyx re-POSTs call body on Redirect). */
export function buildEdgeInboundGreetingContinueUrl(requestUrl: string): string {
  const url = new URL(requestUrl)
  url.pathname = "/api/voice/telnyx/incoming"
  url.searchParams.set("zingGreet", "1")
  return url.toString()
}

/** Hosted WAV on the app origin, or env override — preferred over TTS for instant first audio. */
export function resolveEdgeInstantGreetingAudioUrl(requestUrl: string): string | null {
  const envUrl = edgeInboundInstantGreetingAudioUrl()
  if (envUrl) return envUrl
  try {
    return `${new URL(requestUrl).origin}${INBOUND_GENERIC_GREETING_AUDIO_PATH}`
  } catch {
    return null
  }
}

/** Prebuilt TeXML returned from Edge — `<Play>` pre-recorded audio, then redirect to routing pass 2. */
export function buildEdgeInstantGreetingTexml(continueUrl: string, requestUrl?: string): string {
  const safeContinue = escapeXmlAttr(continueUrl)
  const audioUrl = requestUrl ? resolveEdgeInstantGreetingAudioUrl(requestUrl) : edgeInboundInstantGreetingAudioUrl()
  if (audioUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXmlAttr(audioUrl)}</Play>
  <Redirect method="POST">${safeContinue}</Redirect>
</Response>`
  }
  const voice = (process.env.ZING_TEXML_SAY_VOICE || DEFAULT_SAY_VOICE).trim() || DEFAULT_SAY_VOICE
  const language = (process.env.ZING_TEXML_SAY_LANGUAGE || DEFAULT_SAY_LANGUAGE).trim() || DEFAULT_SAY_LANGUAGE
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXmlAttr(voice)}" language="${escapeXmlAttr(language)}">${escapeXmlText(EDGE_GENERIC_GREETING_TEXT)}</Say>
  <Redirect method="POST">${safeContinue}</Redirect>
</Response>`
}

export function shouldEdgeInstantGreetingIntercept(pathname: string, url: URL, method: string): boolean {
  if (!edgeInboundGreetingFirstEnabled()) return false
  if (!isVoiceIncomingWebhookPath(pathname)) return false
  if (method !== "POST" && method !== "GET") return false
  if (edgeInboundGreetingPassDone(url)) return false
  return true
}
