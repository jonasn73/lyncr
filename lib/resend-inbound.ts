// Resend inbound helpers: verify email.received webhooks + fetch full message body.
// Webhook payloads are metadata-only — body comes from GET /emails/receiving/:id.

import { Webhook } from "svix"

export type ResendEmailReceivedEvent = {
  type: string
  created_at?: string
  data: {
    email_id: string
    created_at?: string
    from?: string
    to?: string[]
    bcc?: string[]
    cc?: string[]
    received_for?: string[]
    message_id?: string | null
    subject?: string | null
    attachments?: unknown[]
  }
}

export type ResendReceivedEmailContent = {
  id: string
  from?: string
  to?: string[]
  subject?: string | null
  text?: string | null
  html?: string | null
  message_id?: string | null
  received_for?: string[]
  headers?: Record<string, string>
  attachments?: unknown[]
  created_at?: string
}

/** Verify Svix signature from Resend. Uses raw body string (do not re-stringify JSON). */
export function verifyResendWebhook(params: {
  rawBody: string
  headers: Headers
  secret: string
}): ResendEmailReceivedEvent {
  const wh = new Webhook(params.secret)
  const verified = wh.verify(params.rawBody, {
    "svix-id": params.headers.get("svix-id") ?? "",
    "svix-timestamp": params.headers.get("svix-timestamp") ?? "",
    "svix-signature": params.headers.get("svix-signature") ?? "",
  }) as ResendEmailReceivedEvent
  return verified
}

/** Parse "Name <email@x.com>" or bare email into parts. */
export function parseEmailAddress(raw: string | null | undefined): {
  email: string
  name: string | null
} {
  const s = (raw ?? "").trim()
  if (!s) return { email: "unknown@unknown", name: null }
  const angle = s.match(/^(.*)<([^>]+)>\s*$/)
  if (angle) {
    const name = angle[1].trim().replace(/^["']|["']$/g, "")
    return { email: angle[2].trim().toLowerCase(), name: name || null }
  }
  return { email: s.toLowerCase(), name: null }
}

/** Fetch full inbound email (html/text) from Resend Receiving API. */
export async function fetchResendReceivedEmail(
  emailId: string
): Promise<ResendReceivedEmailContent | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.error("[resend-inbound] RESEND_API_KEY missing — cannot fetch body")
    return null
  }
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    console.error("[resend-inbound] receiving.get failed:", res.status, errText.slice(0, 400))
    return null
  }
  return (await res.json()) as ResendReceivedEmailContent
}
