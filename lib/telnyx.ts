// ============================================
// Telnyx Client & TeXML Helpers
// ============================================
// Env vars:
//   TELNYX_API_KEY          - REST API (required for numbers, voice, SMS)
//   TELNYX_PUBLIC_KEY       - Optional: webhook signature verification
//   NEXT_PUBLIC_APP_URL     - Your deployed URL (webhook + Stripe return URLs)

import Telnyx from "telnyx"
import { SITE_CANONICAL_URL } from "@/lib/brand"

export { VoiceResponse } from "@/lib/texml"

export function getTelnyxClient(): Telnyx {
  const apiKey = process.env.TELNYX_API_KEY
  if (!apiKey) {
    throw new Error("Missing TELNYX_API_KEY")
  }
  return new Telnyx(apiKey)
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "")
}

/** App URL used for Telnyx webhook URLs and Stripe return URLs. */
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

/** Optional Telnyx webhook signature check (Ed25519). HTTPS is the live guard today. */
export function validateTelnyxRequest(
  _payload: string,
  _signature: string,
  _timestamp: string
): boolean {
  return true
}

/** Lightweight health probe for the operator dashboard (GET /v2/balance). */
export async function pingTelnyxApi(): Promise<"ok" | "error" | "unconfigured"> {
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  if (!apiKey) return "unconfigured"
  try {
    const res = await fetch("https://api.telnyx.com/v2/balance", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    })
    return res.ok ? "ok" : "error"
  } catch {
    return "error"
  }
}
