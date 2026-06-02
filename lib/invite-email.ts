// Receptionist invite email — fully white-labeled under the Lyncr brand.
//
// IMPORTANT: no third-party provider names (the mail vendor, telephony vendor, etc.) may appear in
// the subject, body, or footer. Sender + copy are Lyncr-only. The send transport is an internal
// detail and is never surfaced to the recipient.

export type ReceptionistInviteEmailPayload = {
  from: string
  to: string
  subject: string
  html: string
  text: string
}

/** Lyncr-branded sender. Override with LYNCR_INVITE_FROM_EMAIL / RESEND_FROM_EMAIL (must be a verified lyncr.app mailer). */
function inviteSender(): string {
  return (
    process.env.LYNCR_INVITE_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Lyncr Team <system@lyncr.app>"
  )
}

const INVITE_SUBJECT = "You've been invited to join the Lyncr Operator Network"

/** Build the white-labeled receptionist invite email (dark theme, single onboarding CTA). */
export function buildReceptionistInviteEmailPayload(params: {
  toEmail: string
  onboardingUrl: string
  firstName?: string
}): ReceptionistInviteEmailPayload {
  const name = (params.firstName ?? "").trim() || "there"
  const url = params.onboardingUrl

  const text = [
    `Hi ${name},`,
    "",
    "You've been added as a live receptionist on the Lyncr Operator Network.",
    "Lyncr routes real business calls to your phone or web app so you can answer, take messages, and capture leads.",
    "",
    "Activate your account to get started (this link expires in 48 hours):",
    url,
    "",
    "If you weren't expecting this, you can safely ignore this email.",
    "",
    "— The Lyncr Team",
  ].join("\n")

  const safeUrl = escapeHtml(url)
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
                  You're invited to the Lyncr Operator Network
                </h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#a1a1aa;">
                  Hi ${escapeHtml(name)}, you've been added as a <strong style="color:#e4e4e7;">live receptionist</strong>.
                  Lyncr routes real business calls to your phone or web app so you can answer, take messages, and capture leads.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 4px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background-color:#7c3aed;">
                      <a href="${safeUrl}" target="_blank"
                         style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Activate my account
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;">
                  This activation link expires in 48 hours. If the button doesn't work, paste this address into your browser:
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.5;word-break:break-all;color:#8b8b94;">
                  ${safeUrl}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;border-top:1px solid #26262f;margin-top:16px;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#52525b;">
                  Didn't expect this invite? You can safely ignore this email.<br />
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
    from: inviteSender(),
    to: params.toEmail.trim().toLowerCase(),
    subject: INVITE_SUBJECT,
    html,
    text,
  }
}

/** Send the invite via the configured Lyncr mailer. Provider is an internal detail — never surfaced to recipients. */
export async function sendReceptionistInviteEmail(
  payload: ReceptionistInviteEmailPayload
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "Email delivery is not configured yet — copy the activation link manually." }
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
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      // Keep vendor names out of any message that could bubble up to UI/recipients.
      return { sent: false, error: json.message ? "Email could not be sent." : `Email send failed (HTTP ${res.status}).` }
    }
    return { sent: true }
  } catch {
    return { sent: false, error: "Email send failed — please try again." }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
