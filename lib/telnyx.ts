// ============================================
// Telnyx Client & TeXML Helpers
// ============================================
// Use Telnyx for voice (TeXML) and numbers.
// Install: npm install telnyx
// Env vars:
//   TELNYX_API_KEY          - REST API (required for numbers, etc.)
//   TELNYX_PUBLIC_KEY       - Optional: for webhook signature verification
//   NEXT_PUBLIC_APP_URL     - Your deployed URL

import Telnyx from "telnyx"
// Reuse TwiML for TeXML: Telnyx TeXML is TwiML-compatible (same <Response>, <Dial>, <Say>, etc.)
import twilio from "twilio"

// --- Telnyx REST client (numbers, messaging, etc.) ---
export function getTelnyxClient(): Telnyx {
  const apiKey = process.env.TELNYX_API_KEY
  if (!apiKey) {
    throw new Error("Missing TELNYX_API_KEY")
  }
  return new Telnyx(apiKey)
}

import { SITE_CANONICAL_URL } from "@/lib/brand"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

// --- App URL used for Telnyx webhook URLs and Stripe return URLs ---
export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) {
    const url = stripTrailingSlash(fromEnv)
    if (/getzingapp\.com/i.test(url)) return SITE_CANONICAL_URL
    return url
  }
  const vercelHost = process.env.VERCEL_URL?.trim()
  if (vercelHost) return stripTrailingSlash(`https://${vercelHost}`)
  return SITE_CANONICAL_URL
}

// --- TeXML: use TwiML builder; Telnyx accepts TwiML-compatible XML ---
export const VoiceResponse = twilio.twiml.VoiceResponse

// --- Optional: validate Telnyx webhook signature (Ed25519) ---
// Telnyx sends headers: telnyx-timestamp, telnyx-signature-ed25519
// Set TELNYX_PUBLIC_KEY in env and use a library like @noble/ed25519 to verify.
export function validateTelnyxRequest(
  _payload: string,
  _signature: string,
  _timestamp: string
): boolean {
  // TODO: implement Ed25519 verification with TELNYX_PUBLIC_KEY
  // For now, rely on HTTPS and optional secret path tokens if needed.
  return true
}
