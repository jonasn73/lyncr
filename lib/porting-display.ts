/**
 * User-facing copy helpers. Vendor APIs still store original text; this only changes *display* in Zing.
 */

/**
 * Neutralizes vendor names in toasts, help text, and port threads so the product reads as Zing-first.
 * Skips hostnames (e.g. *.telnyx.com) so links stay valid.
 */
export function displayUserFacingMessage(raw: string): string {
  let s = raw
  s = s.replace(/\bTelnyx Voice AI\b/gi, "Voice AI")
  s = s.replace(/\bTelnyx TTS\b/gi, "cloud voice preview")
  s = s.replace(/\bTelnyx assistant\b/gi, "voice assistant")
  s = s.replace(/\bTelnyx Porting Team\b/gi, "Porting team")
  s = s.replace(/\bTelnyx Admin\b/gi, "Porting team")
  s = s.replace(/\bTelnyx\s+Porting\b/gi, "Porting")
  s = s.replace(/\bfrom Telnyx\b/gi, "from the porting team")
  s = s.replace(/\bVercel\b/gi, "your deployment")
  s = s.replace(/\bNeon\b/gi, "your database")
  s = s.replace(/\bTELNYX_API_KEY\b/g, "your voice API key")
  s = s.replace(/\bTELNYX_AI_ASSISTANT_ID\b/g, "your assistant ID")
  s = s.replace(/\bTelnyx\b/gi, (match, offset, str) => {
    const after = str.slice(offset + match.length, offset + match.length + 4)
    if (after.toLowerCase().startsWith(".com")) return match
    return "the voice service"
  })
  return s
}

/**
 * Port thread messages — same rules as {@link displayUserFacingMessage} (kept for call-site clarity).
 */
export function displayPortingMessageBody(raw: string): string {
  return displayUserFacingMessage(raw)
}
