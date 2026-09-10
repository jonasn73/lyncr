// ============================================
// Telnyx Client & TeXML Helpers
// ============================================
// Env vars:
//   TELNYX_API_KEY          - REST API (required for numbers, voice, SMS)
//   TELNYX_PUBLIC_KEY       - Optional: webhook signature verification
//   NEXT_PUBLIC_APP_URL     - Your deployed URL (webhook + Stripe return URLs)

import { createPublicKey, verify as cryptoVerify } from "crypto"
import { after } from "next/server"
import { SITE_CANONICAL_URL } from "@/lib/brand"

export { VoiceResponse } from "@/lib/texml"

// getTelnyxClient() lived here and was never called — every Telnyx call in this codebase
// goes through fetch against the REST API. It also passed the API key as a bare string,
// which the v6 SDK types reject (it wants ClientOptions), so it would not have worked had
// anything used it. Removed along with the only `telnyx` package import in the repo; the
// dependency itself is now unreferenced and could be dropped from package.json.

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

// DER SPKI prefix for a raw 32-byte Ed25519 public key (OID 1.3.101.112). Node's crypto module
// only accepts Ed25519 keys wrapped in SPKI, so raw keys from Telnyx need this fixed prefix.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

/** Reject webhooks whose Telnyx timestamp is older than this, to block replay of captured requests. */
const TELNYX_WEBHOOK_MAX_SKEW_SECONDS = 300

/**
 * Verify a Telnyx webhook's Ed25519 signature (`telnyx-signature-ed25519` header, over
 * `${telnyx-timestamp header}|${raw body}`) against TELNYX_PUBLIC_KEY, and reject stale
 * timestamps to prevent replay. Returns false — never throws — on any malformed input so
 * callers can uniformly respond 401.
 */
export function validateTelnyxRequest(payload: string, signature: string, timestamp: string): boolean {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY?.trim()
  if (!publicKeyB64 || !signature || !timestamp) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TELNYX_WEBHOOK_MAX_SKEW_SECONDS) {
    return false
  }

  try {
    const rawKey = Buffer.from(publicKeyB64, "base64")
    if (rawKey.length !== 32) return false
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    })
    const sig = Buffer.from(signature, "base64")
    const signedPayload = Buffer.from(`${timestamp}|${payload}`, "utf8")
    return cryptoVerify(null, signedPayload, keyObject, sig)
  } catch {
    return false
  }
}

/**
 * Fail-open signature check for Telnyx webhooks — logs a warning and pages platform admins
 * (debounced — see lib/telnyx-webhook-alerts.ts) on a missing/invalid signature, but never
 * blocks the request. TELNYX_PUBLIC_KEY went live in Production on 2026-09-10; the voice
 * webhook has since been switched to enforce (reject) on a bad signature. The remaining
 * routes here (status callback, porting, messaging) stay fail-open until each shows its own
 * confirmed-clean window of real traffic — see app/api/webhooks/telnyx/voice/route.ts for the
 * enforced version.
 */
export function warnOnInvalidTelnyxSignature(
  headers: { get(name: string): string | null },
  rawBody: string,
  routeLabel: string
): void {
  if (!process.env.TELNYX_PUBLIC_KEY?.trim()) return
  const signature = headers.get("telnyx-signature-ed25519") || ""
  const timestamp = headers.get("telnyx-timestamp") || ""
  if (!validateTelnyxRequest(rawBody, signature, timestamp)) {
    console.warn(`[telnyx] ${routeLabel}: missing/invalid webhook signature (not yet enforced)`)
    // after() so this survives the function instance freezing once the route returns its
    // response — a bare fire-and-forget promise here could get silently dropped.
    after(async () => {
      const { alertOnInvalidTelnyxSignature } = await import("@/lib/telnyx-webhook-alerts")
      await alertOnInvalidTelnyxSignature(routeLabel, false)
    })
  }
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
