// POST /api/webhooks/resend/inbound
// Resend email.received → store in admin_support_emails (Zoho forwards support@ here).

import { NextRequest, NextResponse } from "next/server"
import { upsertAdminSupportEmail } from "@/lib/db"
import {
  fetchResendReceivedEmail,
  parseEmailAddress,
  verifyResendWebhook,
  type ResendEmailReceivedEvent,
} from "@/lib/resend-inbound"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error("[resend-inbound] RESEND_WEBHOOK_SECRET is not set")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  // Must use raw text — re-stringifying JSON breaks Svix signature checks.
  const rawBody = await req.text()

  let event: ResendEmailReceivedEvent
  try {
    event = verifyResendWebhook({ rawBody, headers: req.headers, secret })
  } catch (e) {
    console.warn("[resend-inbound] signature verify failed:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ data: { ignored: true, type: event.type } })
  }

  const emailId = String(event.data?.email_id ?? "").trim()
  if (!emailId) {
    return NextResponse.json({ error: "Missing email_id" }, { status: 400 })
  }

  // Webhook is metadata-only; pull html/text from Receiving API.
  const full = await fetchResendReceivedEmail(emailId)

  const fromRaw = full?.from ?? event.data.from ?? ""
  const fromParsed = parseEmailAddress(
    full?.headers?.from && full.headers.from.includes("<") ? full.headers.from : fromRaw
  )
  // Prefer bare email from webhook/API when header parse already set name.
  if (fromRaw && !fromRaw.includes("<")) {
    fromParsed.email = fromRaw.trim().toLowerCase()
  }

  const toList =
    (full?.to?.length ? full.to : event.data.to)?.map((t) => String(t).trim().toLowerCase()).filter(Boolean) ??
    []
  const receivedFor =
    (full?.received_for?.length ? full.received_for : event.data.received_for)
      ?.map((t) => String(t).trim().toLowerCase())
      .filter(Boolean) ?? []

  const subject = String(full?.subject ?? event.data.subject ?? "(no subject)")
  const receivedAt = String(
    full?.created_at ?? event.data.created_at ?? event.created_at ?? new Date().toISOString()
  )

  try {
    const row = await upsertAdminSupportEmail({
      provider_email_id: emailId,
      message_id: full?.message_id ?? event.data.message_id ?? null,
      from_email: fromParsed.email,
      from_name: fromParsed.name,
      to_email: toList[0] ?? receivedFor[0] ?? "",
      to_emails: toList,
      received_for: receivedFor,
      subject,
      text_body: full?.text ?? null,
      html_body: full?.html ?? null,
      received_at: receivedAt,
      provider_meta: {
        webhook: {
          type: event.type,
          created_at: event.created_at,
          attachments: event.data.attachments ?? [],
        },
        receiving: full
          ? {
              id: full.id,
              headers: full.headers ?? {},
              attachments: full.attachments ?? [],
              reply_to: (full as { reply_to?: unknown }).reply_to ?? [],
            }
          : { fetch_failed: true },
      },
    })
    return NextResponse.json({ data: { id: row.id, provider_email_id: row.provider_email_id } })
  } catch (e) {
    console.error("[resend-inbound] upsert failed:", e)
    const message = e instanceof Error ? e.message : "Failed to store email"
    // 503 if migration missing so Resend retries after Neon is migrated.
    const status = message.includes("127-admin-support-emails") ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
