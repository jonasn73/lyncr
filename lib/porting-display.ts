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
  s = s.replace(/\bif you need assistance,?\s*please reply[^\n.]*/gi, "")
  s = s.replace(/^\d+\.\s+contact your current carrier[^\n]*/gim, "")
  s = s.replace(/^\d+\.\s+update the pin[^\n]*/gim, "")
  s = s.replace(/^\d+\.\s+[^\n]+/gim, "")
  s = s.replace(/\n+(\d+\.\s*)+/g, "\n")
  s = s.replace(/\n\s*(best regards|regards|sincerely|thanks),?\s*[\s\S]*$/i, "")
  s = s.replace(/\n\s*carrier core desk\s*$/i, "")
  s = s.replace(/\n\s*porting order id[:\s]+[^\n]+/gi, "")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

/** Isolate the unique human diagnostic from a carrier desk comment (pre-save / pre-render). */
export function cleansePortingHumanComment(raw: string): string {
  const stripped = stripPortingEmailBoilerplate(raw)
  if (!stripped) return ""

  const sentences = stripped
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  const diagnostic = sentences.filter((sentence) =>
    /pin|passcode|pass code|reject|exception|invoice|loa|account number|must be provided|invalid|cannot be ported|action required|wireless port/i.test(
      sentence
    )
  )

  if (diagnostic.length > 0) {
    const joined = diagnostic.join(" ").trim()
    return joined.endsWith(".") ? joined : `${joined}.`
  }

  const substantive = sentences.find((s) => s.length >= 12 && s.length <= 500)
  if (substantive) return substantive.endsWith(".") ? substantive : `${substantive}.`

  return stripped.slice(0, 2000)
}

/** Core conversational text for bubble rendering. */
export function formatPortingThreadMessage(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("System Update:")) return trimmed
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
  const trimmed = body.trim()
  if (trimmed.startsWith("System Update:")) return true
  const blob = `${title} ${body}`.toLowerCase()
  if (blob.includes("new comment") || blob.includes("carrier core desk")) return false
  return (
    blob.includes("status updated") ||
    blob.includes("status changed") ||
    blob.includes("transfer status changed") ||
    (trimmed.length < 120 &&
      (blob.includes("submitted") || blob.includes("in progress") || blob.includes("exception")))
  )
}
