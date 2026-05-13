// ============================================
// Inbound line identification (voice)
// ============================================
// Short phrase played only to the receptionist / owner leg before the caller
// is bridged. Content is **line identity only** (label / friendly number / last four) — never the account business name.

/** Strip characters that could break TeXML / SSML; keep letters, numbers, common punctuation. */
export function sanitizeWhisperPhrase(raw: string, maxLen = 96): string {
  const trimmed = raw.normalize("NFKC").trim().slice(0, maxLen)
  return trimmed.replace(/[^\p{L}\p{N}\s\-().,'&]/gu, " ").replace(/\s+/g, " ").trim()
}

/**
 * Speakable line-ID only: `phone_numbers.label` (unless default "Main Line"), else `friendly_name`,
 * else last four digits of the DID, else a short default.
 */
export function buildInboundLineWhisperPhrase(
  phoneLineLabel: string,
  phoneLineFriendlyName: string,
  businessLineE164: string
): string {
  const lbl = phoneLineLabel.trim()
  if (lbl && lbl.toLowerCase() !== "main line") {
    return sanitizeWhisperPhrase(lbl)
  }
  const fn = phoneLineFriendlyName.trim()
  if (fn) {
    return sanitizeWhisperPhrase(fn)
  }
  const digits = businessLineE164.replace(/\D/g, "")
  const last4 = digits.slice(-4)
  if (last4.length === 4) {
    return sanitizeWhisperPhrase(last4.split("").join(" "))
  }
  return "Incoming call"
}
