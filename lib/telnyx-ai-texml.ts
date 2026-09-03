// ============================================
// Telnyx TeXML — built-in Voice AI on the live call
// ============================================
// Docs: https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/aiassistant
// Caller stays on the same PSTN leg; no outbound callback provider.

/** Escape a string for use inside XML double-quoted attributes. */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Telnyx TeXML expects `id="assistant-xxxxxxxx-xxxx-…"` (see AIAssistant docs).
 * The REST API often returns a bare UUID — without the prefix, Voice AI may not start (caller hears error / wrong treatment).
 */
const TELNYX_ASSISTANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeTelnyxAssistantIdForTexml(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  if (s.toLowerCase().startsWith("assistant-")) return s
  if (TELNYX_ASSISTANT_UUID.test(s)) return `assistant-${s}`
  return s
}

/**
 * TeXML that **only** connects Voice AI (`<Connect><AIAssistant>` — no `<Say>` in the same `<Response>`).
 * Used from `/incoming` for direct AI (avoids Say→Redirect loops) and from `/ai-bridge` after legacy two-step handoff.
 */
export function buildTelnyxAiAssistantTexml(assistantId: string): string {
  const canonical = normalizeTelnyxAssistantIdForTexml(assistantId)
  const id = escapeXmlAttr(canonical)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><AIAssistant id="${id}"></AIAssistant></Connect></Response>`
}
