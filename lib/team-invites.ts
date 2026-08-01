// Team invite token helpers.

import { randomBytes } from "crypto"

/** Default invite lifetime — 7 days. */
export const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * If fewer than this many ms remain (or already expired), resend regenerates the token.
 * Keeps an existing link working when the owner just wants to copy/resend a fresh invite.
 */
export const TEAM_INVITE_REFRESH_WITHIN_MS = 24 * 60 * 60 * 1000

/** True when the invite is expired or within the refresh window. */
export function teamInviteNeedsTokenRefresh(expiresAt: string, nowMs = Date.now()): boolean {
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return true
  return expiresMs <= nowMs + TEAM_INVITE_REFRESH_WITHIN_MS
}

/** Generate a URL-safe random invite token. */
export function generateTeamInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Preferred owner/admin invite link — redeemed at /register?token=…
 * (team_invites rows; see acceptReceptionistInviteRegistration).
 */
export function buildTeamInviteRegisterUrl(token: string, appUrl: string): string {
  const base = appUrl.replace(/\/$/, "")
  return `${base}/register?token=${encodeURIComponent(token)}`
}

/** Legacy signup URL kept for older emails (`/signup?invite=` + acceptTeamInviteSignup). */
export function buildTeamInviteSignupUrl(token: string, appUrl: string): string {
  const base = appUrl.replace(/\/$/, "")
  return `${base}/signup?invite=${encodeURIComponent(token)}`
}
