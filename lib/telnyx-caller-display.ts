// ============================================
// Telnyx outbound caller display (TeXML Dial)
// ============================================
// Telnyx supports `fromDisplayName` on <Dial> so the callee sees a CNAM-style name with the business DID.
// Keeps characters Telnyx documents as safe for display strings (max 128).

/**
 * Sanitize account business name for Telnyx `Dial` `fromDisplayName` (outbound CNAM hint).
 * Returns `undefined` when there is nothing safe to send.
 */
export function buildTelnyxDialFromDisplayName(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined
  const t = String(raw).normalize("NFKC").trim()
  if (!t) return undefined
  const cleaned = t
    .replace(/[^\p{L}\p{N}\s\-_~!'+.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 128)
  return cleaned.length > 0 ? cleaned : undefined
}
