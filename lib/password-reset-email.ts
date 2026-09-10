// Password-reset email — sent when a user submits /forgot-password for a known account.
//
// IMPORTANT: no third-party provider names may appear in the subject, body, or footer.
// Sender + copy are Lyncr-only. Mirrors lib/signup-confirmation-email.ts's shape.

export type PasswordResetEmailPayload = {
  from: string
  to: string
  subject: string
  html: string
  text: string
}

/** Shared Lyncr sender. Override with RESEND_FROM_EMAIL (must be verified in Resend). */
function resetSender(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Lyncr Team <system@lyncr.app>"
}

export function buildPasswordResetEmailPayload(params: {
  toEmail: string
  name?: string
  resetUrl: string
}): PasswordResetEmailPayload {
  const name = (params.name ?? "").trim() || "there"
  const subject = "Reset your Lyncr password"
  const bodyText = "We got a request to reset your Lyncr password. This link expires in about one hour."

  const text = [
    `Hi ${name},`,
    "",
    bodyText,
    "",
    params.resetUrl,
    "",
    "Didn't request this? You can safely ignore this email — your password won't change.",
    "",
    "— The Lyncr Team",
  ].join("\n")

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#0a0a0f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#15151c;border:1px solid #26262f;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <span style="display:inline-block;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#a78bfa;">Lyncr</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:#f4f4f5;">
                  Reset your password
                </h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#a1a1aa;">
                  Hi ${escapeHtml(name)}, ${bodyText}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 4px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background-color:#7c3aed;">
                      <a href="${params.resetUrl}" target="_blank"
                         style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;border-top:1px solid #26262f;margin-top:16px;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#52525b;">
                  Didn't request this? You can safely ignore this email — your password won't change.<br />
                  &copy; Lyncr &middot; lyncr.app
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim()

  return {
    from: resetSender(),
    to: params.toEmail.trim().toLowerCase(),
    subject,
    html,
    text,
  }
}

/**
 * Send the password-reset email via the configured Lyncr mailer. Never throws — callers must
 * always return the same generic response regardless of send outcome, to avoid leaking whether
 * an account exists.
 */
export async function sendPasswordResetEmail(
  payload: PasswordResetEmailPayload
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" }
  }
  if (!apiKey.startsWith("re_")) {
    console.error("[password-reset-email] RESEND_API_KEY does not look like a Resend key (expected prefix re_)")
    return { sent: false, error: "RESEND_API_KEY looks malformed" }
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string; name?: string }
      console.error("[password-reset-email] send failed", {
        status: res.status,
        name: json.name ?? null,
        message: json.message ?? null,
        from: payload.from,
        to: payload.to,
      })
      return { sent: false, error: json.message ?? `HTTP ${res.status}` }
    }
    return { sent: true }
  } catch (e) {
    console.error("[password-reset-email] network/send error", e instanceof Error ? e.message : e)
    return { sent: false, error: "network error" }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
