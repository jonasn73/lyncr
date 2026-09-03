// Admin impersonation cookies — track operator while session acts as target user.

import {
  createSessionCookieWithTtl,
  getLogoutCookieClearOptions,
  getSessionCookieOptions,
  verifySessionCookie,
} from "@/lib/auth"

/** HTTP-only cookie storing the operator user id while impersonating. */
export const IMPERSONATION_ADMIN_COOKIE = "impersonating_from_admin"

/** Optional post-exit redirect (e.g. /admin/sandbox after quick-switch). */
export const IMPERSONATION_RETURN_COOKIE = "impersonating_return_to"

/** Allowed return paths after exiting impersonation. */
export const SANDBOX_IMPERSONATION_RETURN_PATH = "/admin/sandbox"

/** Impersonation sessions expire after 4 hours. */
const IMPERSONATION_MAX_AGE_SEC = 60 * 60 * 4

export function createImpersonationAdminCookie(adminUserId: string): string {
  return createSessionCookieWithTtl(adminUserId, IMPERSONATION_MAX_AGE_SEC)
}

export function verifyImpersonationAdminCookie(cookieValue: string | undefined): string | null {
  return verifySessionCookie(cookieValue)
}

export function getImpersonationAdminCookieOptions() {
  const base = getSessionCookieOptions()
  return {
    ...base,
    maxAge: IMPERSONATION_MAX_AGE_SEC,
    expires: new Date(Date.now() + IMPERSONATION_MAX_AGE_SEC * 1000),
  }
}

export function getImpersonationAdminCookieClearOptions() {
  return getLogoutCookieClearOptions()
}

export function getImpersonationReturnCookieOptions() {
  return getImpersonationAdminCookieOptions()
}

export function getImpersonationReturnCookieClearOptions() {
  return getLogoutCookieClearOptions()
}

/** Sanitize return path — only allow in-app admin/receptionist routes. */
export function normalizeImpersonationReturnPath(raw: string | undefined | null): string | null {
  const path = (raw ?? "").trim()
  if (!path.startsWith("/")) return null
  if (path.startsWith("//")) return null
  if (path === SANDBOX_IMPERSONATION_RETURN_PATH) return path
  if (path === "/admin" || path.startsWith("/admin/")) return path
  return null
}
