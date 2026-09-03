// Receptionist invite email — fully white-labeled under the Lyncr brand.
//
// IMPORTANT: no third-party provider names (the mail vendor, telephony vendor, etc.) may appear in
// the subject, body, or footer. Sender + copy are Lyncr-only. The send transport is an internal
// detail and is never surfaced to the recipient.
//
// Owner-facing errors (returned to the Team UI) MAY mention Resend so beginners know what to fix.

export type ReceptionistInviteEmailPayload = {
  from: string
  to: string
  subject: string
  html: string
  text: string
}

/** Lyncr-branded sender. Override with LYNCR_INVITE_FROM_EMAIL / RESEND_FROM_EMAIL (must be verified in Resend). */
function inviteSender(): string {
  // Prefer explicit env override, then shared from-address, then lyncr.app default.
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
  /** Activation link — prefer /register?token=… or /onboarding?token=… */
  onboardingUrl?: string
  /** Alias used by older admin invite callers. */
  signupUrl?: string
  firstName?: string
  /** Ignored in copy (kept so older callers stay type-compatible). */
  payoutRateUsd?: number
}): ReceptionistInviteEmailPayload {
  const name = (params.firstName ?? "").trim() || "there"
  const url = (params.onboardingUrl ?? params.signupUrl ?? "").trim()
  if (!url) {
    throw new Error("Invite email needs onboardingUrl or signupUrl")
  }

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

/**
 * Turn a Resend API error into a short, beginner-friendly owner message.
 * Never includes API keys or raw JSON dumps.
 */
function friendlyInviteEmailError(params: {
  status: number
  message?: string
  fromAddress: string
}): string {
  const msg = (params.message ?? "").trim()
  const lower = msg.toLowerCase()

  // Bad / revoked / mistyped API key
  if (
    lower.includes("api key is invalid") ||
    lower.includes("invalid api key") ||
    lower.includes("missing api key") ||
    params.status === 401
  ) {
    return "Email API key is invalid. In Vercel → Project Settings → Environment Variables, replace RESEND_API_KEY with a fresh key from resend.com/api-keys, then redeploy."
  }

  // Domain / from-address not verified in Resend
  if (
    lower.includes("not verified") ||
    lower.includes("domain is not") ||
    lower.includes("from address") ||
    lower.includes("invalid from") ||
    (params.status === 403 && lower.includes("domain"))
  ) {
    return `From address not verified in Resend (${params.fromAddress}). Verify lyncr.app under Resend → Domains, or set RESEND_FROM_EMAIL to a verified sender (testing: Lyncr <onboarding@resend.dev>).`
  }

  // Test-domain restriction: onboarding@resend.dev can only email the account owner
  if (lower.includes("only send testing emails") || lower.includes("verify a domain")) {
    return "Resend is in test mode for that from-address. Verify lyncr.app in Resend → Domains (DNS records), then use Lyncr Team <system@lyncr.app> — or set RESEND_FROM_EMAIL to that verified address."
  }

  // Rate / validation without leaking vendor payload
  if (params.status === 422) {
    return msg
      ? `Email could not be sent: ${msg.slice(0, 180)}`
      : "Email could not be sent (invalid request). Check the from-address and recipient email."
  }

  if (msg) {
    // Keep short; strip anything that looks like a secret
    const safe = msg.replace(/re_[A-Za-z0-9_]+/g, "re_…").slice(0, 180)
    return `Email could not be sent: ${safe}`
  }

  return `Email send failed (HTTP ${params.status}). Copy the activation link and share it manually.`
}

/** Send the invite via the configured Lyncr mailer. Provider is an internal detail — never surfaced to recipients. */
export async function sendReceptionistInviteEmail(
  payload: ReceptionistInviteEmailPayload
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "Email delivery is not configured yet — copy the activation link manually." }
  }

  // Catch obvious paste mistakes before calling the API (no secret logged).
  if (!apiKey.startsWith("re_")) {
    console.error("[invite-email] RESEND_API_KEY does not look like a Resend key (expected prefix re_)")
    return {
      sent: false,
      error:
        "Email API key looks wrong (should start with re_). Update RESEND_API_KEY in Vercel from resend.com/api-keys, then redeploy.",
    }
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
      // Log status + message for Vercel runtime logs (never the API key).
      console.error("[invite-email] send failed", {
        status: res.status,
        name: json.name ?? null,
        message: json.message ?? null,
        from: payload.from,
        to: payload.to,
      })
      return {
        sent: false,
        error: friendlyInviteEmailError({
          status: res.status,
          message: json.message,
          fromAddress: payload.from,
        }),
      }
    }
    return { sent: true }
  } catch (e) {
    console.error("[invite-email] network/send error", e instanceof Error ? e.message : e)
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
