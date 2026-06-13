/**
 * User-facing copy helpers. Vendor APIs still store original text; this only changes *display* in lyncr.
 */

/** Replace upstream vendor/product names with Lyncr white-label porting copy. */
export function displayUserFacingMessage(raw: string): string {
  let s = raw
  s = s.replace(/\bTelnyx Voice AI\b/gi, "Voice AI")
  s = s.replace(/\bTelnyx TTS\b/gi, "cloud voice preview")
  s = s.replace(/\bTelnyx assistant\b/gi, "voice assistant")
  s = s.replace(/\bTelnyx Porting Team\b/gi, "Carrier Core Desk")
  s = s.replace(/\bTelnyx Admin\b/gi, "Carrier Core Desk")
  s = s.replace(/\bTelnyx\s+Porting\b/gi, "Carrier transfer")
  s = s.replace(/\bfrom Telnyx\b/gi, "from the carrier desk")
  s = s.replace(/\bPorting team\b/gi, "Carrier Core Desk")
  s = s.replace(/\bBest regards,?\s*Porting team\b/gi, "Carrier Core Desk")
  s = s.replace(/\bBest regards,?\s*Carrier Core Desk\b/gi, "Carrier Core Desk")
  s = s.replace(/\bVercel\b/gi, "your deployment")
  s = s.replace(/\bNeon\b/gi, "your database")
  s = s.replace(/\bTELNYX_API_KEY\b/g, "your voice API key")
  s = s.replace(/\bTELNYX_AI_ASSISTANT_ID\b/g, "your assistant ID")
  s = s.replace(/\bTelnyx\b/gi, (match, offset, str) => {
    const after = str.slice(offset + match.length, offset + match.length + 4)
    if (after.toLowerCase().startsWith(".com")) return match
    return "carrier network"
  })
  return s
}

/** Strip email-style boilerplate from carrier desk comment threads. */
export function stripPortingEmailBoilerplate(raw: string): string {
  let s = displayUserFacingMessage(raw).trim()
  s = s.replace(/^(hello|hi|dear customer|dear\s+\w+),?\s*/i, "")
  s = s.replace(/^thank you for (using|choosing|submitting)[^.]*\.\s*/i, "")
  s = s.replace(/\bto resolve this[,:]?\s*/gi, "")
  s = s.replace(/\bplease follow these steps[,:]?\s*/gi, "")
  s = s.replace(/\n+(\d+\.\s*)+/g, "\n")
  s = s.replace(/\n\s*(best regards|regards|sincerely|thanks),?\s*[\s\S]*$/i, "")
  s = s.replace(/\n\s*carrier core desk\s*$/i, "")
  s = s.replace(/\n\s*porting order id[:\s]+[^\n]+/gi, "")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

/** Core conversational text for bubble rendering. */
export function formatPortingThreadMessage(raw: string): string {
  const cleaned = stripPortingEmailBoilerplate(raw)
  return cleaned || displayUserFacingMessage(raw).trim()
}

/** Port thread messages — sanitized + boilerplate stripped for UI bubbles. */
export function displayPortingMessageBody(raw: string): string {
  return formatPortingThreadMessage(raw)
}

/** True when a feed item should render as a centered status micro-pill. */
export function isPortingSystemStatusMessage(title: string, body: string, author: string): boolean {
  if (author === "porting_desk" || author === "customer") return false
  const blob = `${title} ${body}`.toLowerCase()
  if (blob.includes("new comment") || blob.includes("carrier core desk")) return false
  return (
    blob.includes("status updated") ||
    blob.includes("status changed") ||
    blob.includes("transfer status") ||
    (body.trim().length < 160 &&
      (blob.includes("submitted") || blob.includes("in progress") || blob.includes("exception")))
  )
}
