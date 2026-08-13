// Send platform-health SMS (Telnyx) or email (Resend) to platform admins only.

import { SITE_NAME } from "@/lib/brand"
import type { User } from "@/lib/types"
import {
  shouldSendAdminPlatformHealthEmail,
  shouldSendAdminPlatformHealthSms,
} from "@/lib/admin-notification-dispatch"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { formatAdminRoutingOverridePhoneForTelnyx } from "@/lib/phone-e164"

export {
  shouldSendAdminPlatformHealthEmail,
  shouldSendAdminPlatformHealthSms,
} from "@/lib/admin-notification-dispatch"

/** Deliver one alert: SMS when a cell exists, otherwise email. Never texts customers. */
export async function deliverPlatformHealthAlert(params: {
  user: Pick<User, "id" | "email" | "phone" | "is_platform_admin" | "admin_notification_preferences" | "name">
  text: string
}): Promise<{ channel: "sms" | "email" | "skipped"; error?: string }> {
  const user = params.user
  // Extra guard — cron must not pass a shop owner here.
  if (!user.is_platform_admin) {
    return { channel: "skipped", error: "not_platform_admin" }
  }

  // E.164 cell from the admin user row (empty if they never saved a phone).
  const phone = formatAdminRoutingOverridePhoneForTelnyx(user.phone) ?? ""
  const wantSms = shouldSendAdminPlatformHealthSms(user)
  const wantEmail = shouldSendAdminPlatformHealthEmail(user)

  // Prefer SMS when the admin has a cell and did not mute the toggle.
  if (phone && wantSms) {
    const sms = await sendTelnyxSms({
      toE164: phone,
      text: params.text,
      // No shop userId — use the platform outbound DID from env / purchased lines.
    })
    if (sms.ok) {
      return { channel: "sms" }
    }
    // SMS failed: fall through to email if that toggle is on.
    if (!wantEmail) {
      return { channel: "skipped", error: sms.error || "sms_failed" }
    }
  }

  // No phone, SMS muted, or SMS failed → email if system-fallback email is on.
  if (wantEmail && user.email.trim()) {
    const emailed = await sendPlatformHealthEmail({
      toEmail: user.email,
      text: params.text,
    })
    if (emailed.sent) return { channel: "email" }
    return { channel: "skipped", error: emailed.error || "email_failed" }
  }

  return { channel: "skipped", error: "no_channel" }
}

/** Soft-fail Resend mail for platform health (same pattern as support-chat-notify). */
async function sendPlatformHealthEmail(params: {
  toEmail: string
  text: string
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { sent: false, error: "RESEND_API_KEY not set" }
  if (!apiKey.startsWith("re_")) return { sent: false, error: "RESEND_API_KEY looks invalid" }

  const to = params.toEmail.trim().toLowerCase()
  if (!to.includes("@")) return { sent: false, error: "Invalid recipient email" }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.LYNCR_INVITE_FROM_EMAIL?.trim() ||
    "Lyncr Ops <system@lyncr.app>"

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${SITE_NAME} platform health`,
        text: params.text,
      }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      return { sent: false, error: json.message || `HTTP ${res.status}` }
    }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send failed" }
  }
}
