// Notify a business owner when Lyncr Support replies in chat (email via Resend).

import { SITE_NAME } from "@/lib/brand"

function supportChatFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.LYNCR_INVITE_FROM_EMAIL?.trim() ||
    "Lyncr Support <support@lyncr.app>"
  )
}

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    ""
  if (!raw) return "https://lyncr.app"
  return raw.startsWith("http") ? raw.replace(/\/$/, "") : `https://${raw.replace(/\/$/, "")}`
}

/**
 * Email the owner that Support replied. Soft-fails if Resend is not configured.
 */
export async function sendSupportChatReplyEmail(params: {
  toEmail: string
  businessName: string
  preview: string
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not set" }
  }
  if (!apiKey.startsWith("re_")) {
    return { sent: false, error: "RESEND_API_KEY looks invalid" }
  }

  const to = params.toEmail.trim().toLowerCase()
  if (!to.includes("@")) {
    return { sent: false, error: "Invalid recipient email" }
  }

  const helpUrl = `${appBaseUrl()}/dashboard/help#support-chat`
  const preview = params.preview.replace(/\s+/g, " ").trim().slice(0, 240) || "New reply from Support"
  const biz = params.businessName.trim() || "your business"
  const subject = `${SITE_NAME} Support replied — ${biz}`

  const text = [
    `Hi,`,
    ``,
    `Lyncr Support replied to your in-app chat for ${biz}:`,
    ``,
    preview,
    ``,
    `Open Help & Support to continue the conversation:`,
    helpUrl,
    ``,
    `— ${SITE_NAME}`,
  ].join("\n")

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111">
      <p>Hi,</p>
      <p>Lyncr Support replied to your in-app chat for <strong>${escapeHtml(biz)}</strong>:</p>
      <blockquote style="margin:12px 0;padding:12px 14px;border-left:3px solid #7c3aed;background:#f8fafc;border-radius:6px">
        ${escapeHtml(preview)}
      </blockquote>
      <p><a href="${escapeHtml(helpUrl)}" style="display:inline-block;padding:10px 16px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open chat</a></p>
      <p style="color:#64748b;font-size:13px">Or visit Help &amp; Support in your ${escapeHtml(SITE_NAME)} dashboard.</p>
    </div>
  `

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: supportChatFromAddress(),
        to: [to],
        subject,
        text,
        html,
      }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      console.error("[support-chat-notify] email failed", res.status, json.message)
      return { sent: false, error: json.message || `HTTP ${res.status}` }
    }
    return { sent: true }
  } catch (e) {
    console.error("[support-chat-notify] network error", e)
    return { sent: false, error: e instanceof Error ? e.message : "send failed" }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
