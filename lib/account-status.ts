// Account status values for onboarding_profiles.account_status (admin overrides + voice routing guard).

import { VoiceResponse } from "@/lib/telnyx"

export const ACCOUNT_STATUSES = ["active", "suspended", "flagged"] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export function parseAccountStatus(value: unknown): AccountStatus | null {
  const s = String(value ?? "").trim().toLowerCase()
  if (s === "active" || s === "suspended" || s === "flagged") return s
  return null
}

/** Spoken on fallback paths when account_status is suspended (primary inbound uses `<Reject>` for speed). */
export const SUSPENDED_LINE_TEXML_MESSAGE = "This line is temporarily unavailable."

/**
 * Instant busy signal — use as the **first** TeXML verb so Telnyx rejects before ringback / dial legs.
 * (A spoken `<Say>` waits for TTS; callers may hear one ring while the webhook + DB round-trip completes.)
 */
export function buildSuspendedInboundRejectTexml(): string {
  const texml = new VoiceResponse()
  texml.reject({ reason: "busy" })
  return texml.toString()
}

export function isAccountRoutingBlocked(status: string | null | undefined): boolean {
  return parseAccountStatus(status) === "suspended"
}

export function accountStatusLabel(status: string): string {
  const parsed = parseAccountStatus(status)
  if (parsed === "suspended") return "Suspended"
  if (parsed === "flagged") return "Flagged"
  return "Active"
}
