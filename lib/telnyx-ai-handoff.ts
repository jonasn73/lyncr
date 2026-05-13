// ============================================
// Telnyx / TeXML — two-step Voice AI handoff
// ============================================
// Some interpreters ignore or skip <Say> when it shares one <Response> with <Connect><AIAssistant>.
// Pattern: Say + Redirect → second URL returns only <Connect><AIAssistant> (see /api/voice/telnyx/ai-bridge/u/[userId]).

import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { texmlSayNatural } from "@/lib/texml-say-voice"

/**
 * Silent handoff: one `<Redirect>` to `/ai-bridge` (no `<Say>`). Telnyx often needs this second fetch
 * before `<Connect><AIAssistant>` works; putting `<Connect>` on the first `/incoming` response can go dead-air.
 */
export function buildRedirectOnlyToAiBridgeTeXML(userId: string, callSid?: string): string {
  const appUrl = getAppUrl() // Base URL of this app (from env), so Telnyx can request our next TeXML step
  const cs = callSid?.trim() // Optional Telnyx call id, trimmed or empty
  const qs = cs ? `?callSid=${encodeURIComponent(cs)}` : "" // Append query only when we have a call id (safe for URLs)
  const vr = new VoiceResponse() // Builder that outputs TwiML-compatible TeXML for Telnyx
  vr.redirect(
    { method: "GET" }, // Telnyx will GET the next document (avoids empty POST body issues)
    `${appUrl}/api/voice/telnyx/ai-bridge/u/${encodeURIComponent(userId)}${qs}` // Second step: pure <Connect><AIAssistant>
  )
  return vr.toString() // Final XML string sent back to Telnyx
}

/**
 * Minimal spoken bridge + `<Redirect>` to `/ai-bridge` — use when Telnyx POSTs `/incoming` again
 * (hit ≥ 2). **Do not** return `<Connect><AIAssistant>` on repeat `/incoming`; Telnyx often plays a
 * generic “application error” message for that TeXML shape on the voice URL.
 */
export function buildShortSayThenRedirectToAiBridgeTeXML(userId: string, callSid?: string): string {
  const appUrl = getAppUrl() // Public base URL for the redirect target
  const cs = callSid?.trim() // Telnyx call id when present
  const q =
    cs.length > 0
      ? `?callSid=${encodeURIComponent(cs)}&zingFrom=incoming-repeat`
      : `?zingFrom=incoming-repeat` // Query string for logging / cache behavior on ai-bridge
  const vr = new VoiceResponse() // TwiML builder Telnyx accepts
  texmlSayNatural(vr, "One moment please.") // Short TTS so the document is not Redirect-only on a “stuck” leg
  vr.pause({ length: 1 }) // Small gap before fetch (mirrors longer pause on the full Say variant)
  vr.redirect(
    { method: "GET" }, // GET /ai-bridge returns only <Connect><AIAssistant>
    `${appUrl}/api/voice/telnyx/ai-bridge/u/${encodeURIComponent(userId)}${q}`
  )
  return vr.toString() // Complete TeXML for Telnyx
}

/** After redirect loops + optional last-resort `<Connect>`, end the call clearly (not Telnyx’s generic error tone). */
export function buildAiHandoffGiveUpTeXML(): string {
  const vr = new VoiceResponse() // TwiML builder
  texmlSayNatural(
    vr,
    "We're sorry, our voice assistant did not start on this line. Please try again in a few minutes, or contact support if this keeps happening."
  ) // Explains it is the AI leg, not a random app error
  vr.hangup() // End the call leg
  return vr.toString() // TeXML string for Telnyx
}

/**
 * TeXML that speaks a short line, then fetches the pure AI `<Connect>` document from our server.
 * Uses the Twilio `VoiceResponse` builder so `<Say>` matches what Telnyx expects for TwiML-compatible TeXML.
 * @param callSid — optional; forwarded on the redirect URL so the bridge can tie voicemail to the same call.
 */
export function buildSayThenRedirectToAiBridgeTeXML(userId: string, callSid?: string): string {
  const appUrl = getAppUrl()
  const cs = callSid?.trim()
  const qs = cs ? `?callSid=${encodeURIComponent(cs)}` : ""
  const vr = new VoiceResponse()
  texmlSayNatural(vr, "Thanks for calling. Please hold a moment while we connect you to our assistant.")
  // Give TTS time to finish before the next fetch; some Telnyx builds were skipping audio when Redirect followed immediately.
  vr.pause({ length: 2 })
  // GET avoids edge cases where a redirect POST has an empty body and the app returns 4xx.
  vr.redirect(
    { method: "GET" },
    `${appUrl}/api/voice/telnyx/ai-bridge/u/${encodeURIComponent(userId)}${qs}`
  )
  return vr.toString()
}
