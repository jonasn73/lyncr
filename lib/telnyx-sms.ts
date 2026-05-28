// ============================================
// Telnyx outbound SMS (lead alerts to owner)
// ============================================
// Env: TELNYX_API_KEY (required), TELNYX_MESSAGING_FROM_E164 (optional override).
// When unset, we auto-pick the account's first active Telnyx-purchased line (provider SID set).

import { getProviderLinkedActiveNumber } from "@/lib/db"

/** Resolve the E.164 sender for outbound SMS (env override → account line → any platform line). */
export async function resolveTelnyxMessagingFromE164(userId?: string): Promise<string | null> {
  const envFrom = process.env.TELNYX_MESSAGING_FROM_E164?.trim()
  if (envFrom) return envFrom
  return getProviderLinkedActiveNumber(userId)
}

/**
 * Send a plain SMS via Telnyx REST API. Returns ok:false if not configured.
 */
export async function sendTelnyxSms(params: {
  toE164: string
  text: string
  /** Workspace owner — used to pick their purchased Telnyx line as the SMS sender. */
  userId?: string
  /** Explicit sender override (skips resolveTelnyxMessagingFromE164). */
  fromE164?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  const from =
    params.fromE164?.trim() || (await resolveTelnyxMessagingFromE164(params.userId))
  if (!apiKey) return { ok: false, error: "TELNYX_API_KEY missing" }
  if (!from) {
    return {
      ok: false,
      error:
        "No Telnyx SMS sender — set TELNYX_MESSAGING_FROM_E164 in Vercel or buy a Telnyx number with SMS enabled",
    }
  }

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: params.toE164,
      text: params.text,
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    return { ok: false, error: err.slice(0, 200) }
  }
  return { ok: true }
}
