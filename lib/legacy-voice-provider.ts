// ============================================
// Sigo - Legacy Voice Provider Helpers
// ============================================
// Compatibility layer for legacy provider-backed endpoints.
// Env vars needed:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   NEXT_PUBLIC_APP_URL

import twilio from "twilio"

// Provider-neutral helper for legacy compatibility endpoints.
export function getLegacyProviderClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN")
  }
  return twilio(accountSid, authToken)
}

// Validate that an incoming legacy webhook is signed correctly.
export function validateLegacyProviderRequest(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return false
  return twilio.validateRequest(authToken, signature, url, params)
}

// TwiML builder helpers used by legacy compatibility routes.
export const VoiceResponse = twilio.twiml.VoiceResponse

export function getLegacyAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://your-app.vercel.app"
}

// Backward-compat exports for existing call sites.
export const getTwilioClient = getLegacyProviderClient
export const validateTwilioRequest = validateLegacyProviderRequest
export const getAppUrl = getLegacyAppUrl
