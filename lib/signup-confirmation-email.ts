// New-signup confirmation email — sent right after a business owner creates an account.
//
// IMPORTANT: no third-party provider names (the mail vendor, telephony vendor, etc.) may appear in
// the subject, body, or footer. Sender + copy are Lyncr-only. The send transport is an internal
// detail and is never surfaced to the recipient. Mirrors lib/invite-email.ts's shape.
//
// Copy must agree with app/waiting-approval/page.tsx: most real signups land in "pending" (only
// business names starting with "TEST" — see lib/account-status.ts signupAccountStatusForBusinessName
// — go "active" immediately), so the default message is "we got it, wait for approval," not "welcome."

export type SignupConfirmationEmailPayload = {
  from: string
  to: string
  subject: string
  html: string
  text: string
}

/** Shared Lyncr sender. Override with RESEND_FROM_EMAIL (must be verified in Resend). */
function confirmationSender(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Lyncr Team <system@lyncr.app>"
}

const LOGIN_URL = "https://lyncr.app/login"
/** Field techs log in with their phone number — only /tech/login converts that to their account email. */
const TECH_LOGIN_URL = "https://lyncr.app/tech/login"

/** Build the signup confirmation email — branches copy on whether the account is pending approval. */
export function buildSignupConfirmationEmailPayload(params: {
  toEmail: string
  name?: string
  businessName: string
  /** account_status right after signup — "pending" (default queue) or "active" (e.g. TEST accounts). */
  status: string
}): SignupConfirmationEmailPayload {
  const name = (params.name ?? "").trim() || "there"
  const business = params.businessName.trim() || "your business"
  const isPending = params.status === "pending"

  const subject = isPending ? "We got your signup — pending approval" : "You're all set — welcome to Lyncr"
  const heading = isPending ? "We got your signup" : "You're all set"
  const bodyText = isPending
    ? `${business} is waiting for approval. You can close this page — when we turn you on, log in again and continue setup.`
    : `Welcome to Lyncr! ${business} is ready to go — log in to finish setup.`

  const text = [`Hi ${name},`, "", bodyText, "", "— The Lyncr Team"].join("\n")

  const safeBusiness = escapeHtml(business)
  const safeBody = isPending
    ? `<strong style="color:#e4e4e7;">${safeBusiness}</strong> is waiting for approval. You can close this page — when we turn you on, log in again and continue setup.`
    : `Welcome to Lyncr! <strong style="color:#e4e4e7;">${safeBusiness}</strong> is ready to go — log in to finish setup.`

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
                  ${escapeHtml(heading)}
                </h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#a1a1aa;">
                  Hi ${escapeHtml(name)}, ${safeBody}
                </p>
              </td>
            </tr>
            ${
              isPending
                ? ""
                : `<tr>
              <td style="padding:8px 32px 4px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background-color:#7c3aed;">
                      <a href="${LOGIN_URL}" target="_blank"
                         style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Log in
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
            }
            <tr>
              <td style="padding:24px 32px 28px 32px;border-top:1px solid #26262f;margin-top:16px;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#52525b;">
                  Didn't sign up for Lyncr? You can safely ignore this email.<br />
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
    from: confirmationSender(),
    to: params.toEmail.trim().toLowerCase(),
    subject,
    html,
    text,
  }
}

/**
 * Domains this app synthesizes as placeholder `users.email` values for phone-first accounts
 * (field techs, some SMS-invited receptionists/operators) — never a real inbox, never send here.
 * Real contact addresses captured separately (e.g. users.contact_email) are exempt by construction
 * since callers only pass those through when the address is user-supplied.
 */
const SYNTHETIC_EMAIL_SUFFIXES = ["@tech.lyncr.app", "@sms.lyncr.app", "@invite.lyncr.app"]

export function isSyntheticPlaceholderEmail(email: string): boolean {
  const lower = email.trim().toLowerCase()
  return SYNTHETIC_EMAIL_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/** Build the confirmation email for a receptionist or field-technician account going active. */
export function buildTeamMemberConfirmationEmailPayload(params: {
  toEmail: string
  name?: string
  role: "receptionist" | "field_tech"
}): SignupConfirmationEmailPayload {
  const name = (params.name ?? "").trim() || "there"
  const roleLabel = params.role === "field_tech" ? "technician" : "receptionist"
  const loginUrl = params.role === "field_tech" ? TECH_LOGIN_URL : LOGIN_URL
  const subject = "You're all set — welcome to Lyncr"
  const bodyText = `Your Lyncr ${roleLabel} account is ready. Log in to get started.`
  const text = [`Hi ${name},`, "", bodyText, "", "— The Lyncr Team"].join("\n")
  const safeBody = `Your Lyncr <strong style="color:#e4e4e7;">${escapeHtml(roleLabel)}</strong> account is ready. Log in to get started.`

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
                  You're all set
                </h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#a1a1aa;">
                  Hi ${escapeHtml(name)}, ${safeBody}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 4px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background-color:#7c3aed;">
                      <a href="${loginUrl}" target="_blank"
                         style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Log in
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;border-top:1px solid #26262f;margin-top:16px;">
                <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#52525b;">
                  Didn't expect this? You can safely ignore this email.<br />
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
    from: confirmationSender(),
    to: params.toEmail.trim().toLowerCase(),
    subject,
    html,
    text,
  }
}

/**
 * Send the signup confirmation via the configured Lyncr mailer. Never throws — signup must
 * succeed even when email delivery is unconfigured or fails; callers should fire-and-forget
 * and just log the result.
 */
export async function sendSignupConfirmationEmail(
  payload: SignupConfirmationEmailPayload
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" }
  }
  if (!apiKey.startsWith("re_")) {
    console.error("[signup-confirmation-email] RESEND_API_KEY does not look like a Resend key (expected prefix re_)")
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
      console.error("[signup-confirmation-email] send failed", {
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
    console.error("[signup-confirmation-email] network/send error", e instanceof Error ? e.message : e)
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
