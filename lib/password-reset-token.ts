// Signed one-hour password reset tokens (HMAC, no extra DB table).

import { createHmac, timingSafeEqual } from "crypto"

const PURPOSE = "pwd-reset"
const TTL_MS = 60 * 60 * 1000

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set and at least 16 characters")
  }
  return s
}

/** Issue a reset token for `userId` (valid ~1 hour). */
export function createPasswordResetToken(userId: string): string {
  const exp = Date.now() + TTL_MS
  const payload = JSON.stringify({ userId, exp, purpose: PURPOSE })
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url")
  const sig = createHmac("sha256", secret()).update(payloadB64).digest("base64url")
  return `${payloadB64}.${sig}`
}

/** Verify token; returns user id or null. */
export function verifyPasswordResetToken(token: string): string | null {
  if (!token?.includes(".")) return null
  const [payloadB64, sig] = token.split(".")
  const expectedSig = createHmac("sha256", secret()).update(payloadB64).digest("base64url")
  if (expectedSig.length !== sig.length || !timingSafeEqual(Buffer.from(expectedSig, "utf8"), Buffer.from(sig, "utf8"))) {
    return null
  }
  let payload: { userId: string; exp: number; purpose: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (payload.purpose !== PURPOSE || !payload.userId || typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return null
  }
  return payload.userId
}
