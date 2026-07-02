// ============================================
// US-focused E.164 helper (callbacks / SMS)
// ============================================
// Turns common US phone inputs into +1… format for Telnyx.

/**
 * Normalize a phone string to E.164 for US numbers when possible.
 * @param raw - Digits or formatted number from a form or carrier
 */
/**
 * Build a `tel:` href for mobile call-back links (defaults US +1 for 10-digit numbers).
 */
export function buildTelHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("+")) return `tel:${trimmed.replace(/[^\d+]/g, "")}`
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`
  if (digits.length === 10) return `tel:+1${digits}`
  return digits ? `tel:${digits}` : null
}

export function toE164(raw: string): string {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (trimmed.startsWith("+")) return `+${digits}`
  return `+${digits}`
}

/**
 * Sanitize platform-admin `admin_routing_override_phone` for Telnyx inbound `<Number>` dial.
 * Strips spaces/dashes, then ensures a leading '+' (US +1 when the admin omitted country code).
 */
/** Line-level override wins; workspace org override applies when the line has none. */
export function resolveScopedAdminRoutingOverrideE164(
  lineOverride: string | null | undefined,
  organizationOverride: string | null | undefined
): string | null {
  const fromLine = formatAdminRoutingOverridePhoneForTelnyx(lineOverride)
  if (fromLine) return fromLine
  return formatAdminRoutingOverridePhoneForTelnyx(organizationOverride)
}

export function formatAdminRoutingOverridePhoneForTelnyx(
  admin_routing_override_phone: string | null | undefined
): string | null {
  // Turn null/undefined into a string and trim outer spaces from the admin input.
  const raw = String(admin_routing_override_phone ?? "").trim()
  // Blank override means routing should use the normal owner/receptionist path.
  if (!raw) return null

  // Track whether the admin typed '+' so we do not double-prefix US numbers.
  const hadPlusPrefix = raw.startsWith("+")

  // Strip spaces, dashes, parentheses — Telnyx expects clean E.164 digits after '+'.
  const digitsOnly = raw.replace(/\D/g, "")
  // Nothing left after stripping means the value is not dialable.
  if (!digitsOnly) return null

  // Build the final destination Telnyx will place inside `<Number>…</Number>`.
  let formattedNumber: string
  if (hadPlusPrefix) {
    // Value already included country code (e.g. "+1 (555) 123-4567" → "+15551234567").
    formattedNumber = `+${digitsOnly}`
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    // US number entered as 1 + 10 digits without '+' (e.g. "15551234567").
    formattedNumber = `+${digitsOnly}`
  } else {
    // Default US: force +1 when no '+' was entered (e.g. "5551234567" → "+15551234567").
    formattedNumber = `+1${digitsOnly}`
  }

  // Reject too-short or too-long strings so we never send garbage to Telnyx.
  const dialDigitCount = formattedNumber.replace(/\D/g, "").length
  if (dialDigitCount < 10 || dialDigitCount > 15) return null

  return formattedNumber
}
