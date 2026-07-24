// Signed public receipt tokens — no extra DB table (HMAC like password reset).

import { createHmac, timingSafeEqual } from "crypto"

const PURPOSE = "pay-receipt"
/** Receipt links stay valid for 180 days (customer may reopen later). */
const TTL_MS = 180 * 24 * 60 * 60 * 1000

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set and at least 16 characters")
  }
  return s
}

/** Issue a public receipt token for a succeeded PaymentIntent. */
export function createPaymentReceiptToken(params: {
  paymentIntentId: string
  ownerUserId: string
}): string {
  const exp = Date.now() + TTL_MS
  const payload = JSON.stringify({
    pi: params.paymentIntentId,
    u: params.ownerUserId,
    exp,
    purpose: PURPOSE,
  })
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url")
  const sig = createHmac("sha256", secret()).update(payloadB64).digest("base64url")
  return `${payloadB64}.${sig}`
}

/** Verify token; returns PI + owner user id, or null. */
export function verifyPaymentReceiptToken(
  token: string
): { paymentIntentId: string; ownerUserId: string } | null {
  if (!token?.includes(".")) return null
  const [payloadB64, sig] = token.split(".")
  if (!payloadB64 || !sig) return null
  const expectedSig = createHmac("sha256", secret()).update(payloadB64).digest("base64url")
  try {
    if (
      expectedSig.length !== sig.length ||
      !timingSafeEqual(Buffer.from(expectedSig, "utf8"), Buffer.from(sig, "utf8"))
    ) {
      return null
    }
  } catch {
    return null
  }
  let payload: { pi?: string; u?: string; exp?: number; purpose?: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (
    payload.purpose !== PURPOSE ||
    !payload.pi ||
    !payload.u ||
    typeof payload.exp !== "number" ||
    payload.exp < Date.now()
  ) {
    return null
  }
  return { paymentIntentId: payload.pi, ownerUserId: payload.u }
}
