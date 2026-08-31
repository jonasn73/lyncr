// ============================================
// Sigo - Session (HTTP-only cookie)
// ============================================
// Signs a session payload (userId + expiry) and verifies it.
// Uses HMAC-SHA256 so we don't need a sessions table.
// Set SESSION_SECRET in .env.local (e.g. openssl rand -base64 32).

import { createHmac, timingSafeEqual } from "crypto"
import { env } from "@/lib/env" // Type-safe, validated env manager (replaces raw process.env).

const COOKIE_NAME = "lyncr_session"
/** Legacy cookie from the Zing rename — still accepted so logins survive deploy. */
const LEGACY_COOKIE_NAME = "zing_session"
const MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days so session survives refreshes and long gaps

function getSecret(): string {
  const secret = env.SESSION_SECRET // Validated by lib/env.ts (required, min 16 chars).
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set and at least 16 characters")
  }
  return secret
}

/** Build signed cookie value: base64url(payload) + "." + signature */
export function createSessionCookie(userId: string): string {
  return createSessionCookieWithTtl(userId, MAX_AGE_SEC)
}

/** Signed session cookie with a custom TTL (seconds). */
export function createSessionCookieWithTtl(userId: string, maxAgeSec: number): string {
  const secret = getSecret()
  const expiresAt = Date.now() + maxAgeSec * 1000
  const payload = JSON.stringify({ userId, exp: expiresAt })
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url")
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  return `${payloadB64}.${sig}`
}

/** Verify cookie and return userId or null */
export function verifySessionCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue || !cookieValue.includes(".")) return null
  const [payloadB64, sig] = cookieValue.split(".")
  const secret = getSecret()
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url")
  if (expectedSig.length !== sig.length || !timingSafeEqual(Buffer.from(expectedSig, "utf8"), Buffer.from(sig, "utf8"))) {
    return null
  }
  let payload: { userId: string; exp: number }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (!payload.userId || typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return null
  }
  return payload.userId
}

export function getSessionCookieName(): string {
  return COOKIE_NAME
}

/** Legacy Zing cookie — clear on logout so both names die. */
export function getLegacySessionCookieName(): string {
  return LEGACY_COOKIE_NAME
}

export function getSessionCookieOptions(): {
  httpOnly: boolean
  secure: boolean
  sameSite: "none"
  path: string
  maxAge: number
  expires: Date
} {
  const expires = new Date(Date.now() + MAX_AGE_SEC * 1000)
  // SameSite=None + Secure is REQUIRED so the session cookie is sent back when
  // the app runs inside a cross-origin HTTPS iframe (e.g. the v0 preview).
  // With SameSite=Lax the browser drops the cookie on cross-site navigations,
  // which made login "succeed" (200) but immediately bounce to /login again.
  // Both the v0 preview and production are served over HTTPS, so Secure is safe.
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: MAX_AGE_SEC,
    expires, // explicit expiry helps some browsers persist across refresh
  }
}

/** Same Site/Secure/Path as login so browsers actually remove the cookie (especially `Secure` in production). */
export function getLogoutCookieClearOptions(): {
  httpOnly: boolean
  secure: boolean
  sameSite: "none"
  path: string
  maxAge: number
  expires: Date
} {
  const login = getSessionCookieOptions()
  return {
    httpOnly: login.httpOnly,
    secure: login.secure,
    sameSite: login.sameSite,
    path: login.path,
    maxAge: 0,
    expires: new Date(0),
  }
}

/** Read session from request cookies (for API routes). Returns userId or null. */
export function getUserIdFromRequest(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  // Prefer lyncr_session; fall back to legacy zing_session until all browsers refresh.
  const lyncr = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  const legacy = cookieHeader.match(new RegExp(`${LEGACY_COOKIE_NAME}=([^;]+)`))
  return (
    verifySessionCookie(lyncr?.[1]?.trim()) ||
    verifySessionCookie(legacy?.[1]?.trim()) ||
    null
  )
}
