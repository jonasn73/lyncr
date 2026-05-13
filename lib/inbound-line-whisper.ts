// ============================================
// Inbound line identification (voice)
// ============================================
// Short phrase played only to the receptionist / owner leg before the caller
// is bridged, so they know which business number was dialed.

/** Strip characters that could break TeXML / SSML; keep letters, numbers, common punctuation. */
export function sanitizeWhisperPhrase(raw: string, maxLen = 96): string {
  const trimmed = raw.normalize("NFKC").trim().slice(0, maxLen)
  return trimmed.replace(/[^\p{L}\p{N}\s\-().,'&]/gu, " ").replace(/\s+/g, " ").trim()
}

/** Line-only part: label, friendly DID text, spaced last four, or a short default. */
function whisperLineIdentificationPart(
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

/**
 * Builds the whisper string: **account business name** (when set), then the line identifier.
 * Avoids saying the same text twice when the line label matches the business name.
 */
export function buildInboundLineWhisperPhrase(
  businessName: string,
  phoneLineLabel: string,
  phoneLineFriendlyName: string,
  businessLineE164: string
): string {
  const linePart = whisperLineIdentificationPart(phoneLineLabel, phoneLineFriendlyName, businessLineE164)
  const biz = sanitizeWhisperPhrase(businessName.trim(), 72)
  if (!biz) {
    return linePart
  }
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
  if (norm(biz) === norm(linePart)) {
    return biz
  }
  const combined = `${biz}. ${linePart}`.replace(/\s+/g, " ").trim()
  return sanitizeWhisperPhrase(combined, 140)
}
