// Raw TeXML for the receptionist / owner "Press 1 to connect" screen (`<Number url="…">`).

import { getTexmlSayVoiceAttributes } from "@/lib/texml-say-voice"
import { escapeXmlAttr } from "@/lib/telnyx-inbound-media-quality"

function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Callee hears this on their cell the instant they pick up — before the caller is bridged. */
export function buildReceptionistPress1ScreenTexml(businessName: string, gateActionUrl: string): string {
  const attrs = getTexmlSayVoiceAttributes()
  const safeAction = escapeXmlAttr(gateActionUrl)
  const name = escapeXmlText(businessName.trim() || "your business")
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" validDigits="1" timeout="12" action="${safeAction}" method="POST">
    <Say voice="${escapeXmlAttr(attrs.voice)}" language="${escapeXmlAttr(attrs.language)}">Lyncr alert. Incoming call for ${name}. Press 1 to connect.</Say>
  </Gather>
  <Say voice="${escapeXmlAttr(attrs.voice)}" language="${escapeXmlAttr(attrs.language)}">No key received. Goodbye.</Say>
  <Hangup/>
</Response>`
}

/** After the agent presses 1 — empty TeXML completes the \`<Number url>\` screen and bridges the caller. */
export function buildReceptionistPress1AcceptedTexml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
}

/** Wrong key / timeout on the gate leg — hang up this leg only so the caller hits fallback. */
export function buildReceptionistPress1RejectedTexml(): string {
  const attrs = getTexmlSayVoiceAttributes()
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXmlAttr(attrs.voice)}" language="${escapeXmlAttr(attrs.language)}">No connection made. Goodbye.</Say>
  <Hangup/>
</Response>`
}
