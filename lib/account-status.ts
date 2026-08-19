// Account status values for onboarding_profiles.account_status (admin overrides + voice routing guard).

export const ACCOUNT_STATUSES = ["pending", "active", "flagged", "suspended", "denied"] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export function parseAccountStatus(value: unknown): AccountStatus | null {
  const s = String(value ?? "").trim().toLowerCase()
  if (s === "pending" || s === "active" || s === "suspended" || s === "flagged" || s === "denied") {
    return s
  }
  return null
}

/** Spoken on fallback paths when account_status is suspended (primary inbound uses `<Reject>` for speed). */
export const SUSPENDED_LINE_TEXML_MESSAGE = "This line is temporarily unavailable."

/**
 * Instant busy signal — use as the **first** TeXML verb so Telnyx rejects before ringback / dial legs.
 * (A spoken `<Say>` waits for TTS; callers may hear one ring while the webhook + DB round-trip completes.)
 */
export function buildSuspendedInboundRejectTexml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>`
}

/** True when inbound calls must not ring this shop (pending, denied, or suspended). */
export function isAccountRoutingBlocked(status: string | null | undefined): boolean {
  const parsed = parseAccountStatus(status)
  return parsed === "suspended" || parsed === "pending" || parsed === "denied"
}

/** True when the owner may use Lines / onboarding / shop APIs. Flagged shops stay usable. */
export function isShopAccountUsable(status: string | null | undefined): boolean {
  const parsed = parseAccountStatus(status)
  if (!parsed) return true
  return parsed === "active" || parsed === "flagged"
}

export function accountStatusLabel(status: string): string {
  const parsed = parseAccountStatus(status)
  if (parsed === "pending") return "Pending"
  if (parsed === "suspended") return "Suspended"
  if (parsed === "flagged") return "Flagged"
  if (parsed === "denied") return "Denied"
  return "Active"
}

/**
 * TEST shops skip the approval queue (live testers). Real public signups wait.
 * Matches a shop name that starts with the word TEST (any case).
 */
export function signupAccountStatusForBusinessName(businessName: string): AccountStatus {
  const name = String(businessName || "").trim()
  if (/^test\b/i.test(name)) return "active"
  return "pending"
}

export function accountWaitPath(status: string | null | undefined): "/waiting-approval" | "/account-denied" | null {
  const parsed = parseAccountStatus(status)
  if (parsed === "pending") return "/waiting-approval"
  if (parsed === "denied") return "/account-denied"
  return null
}
