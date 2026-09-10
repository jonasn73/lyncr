// Pages platform admins (same SMS/email channel as Neon/Telnyx platform-health alerts) when a
// Telnyx webhook signature fails to verify — otherwise the only record of a real problem here
// is Vercel's raw runtime logs, which nobody is watching once this session ends.

import { listPlatformAdminContacts, markWebhookSignatureAlertSent, recordWebhookSignatureFailure } from "@/lib/db"
import { deliverPlatformHealthAlert } from "@/lib/platform-health-notify"

/** The 4 Telnyx webhook routes with signature verification, and whether each rejects yet. */
export const TELNYX_WEBHOOK_SIGNATURE_ROUTES: { routeLabel: string; enforced: boolean }[] = [
  { routeLabel: "webhooks/telnyx/voice", enforced: true },
  { routeLabel: "voice/telnyx/status", enforced: false },
  { routeLabel: "webhooks/telnyx/porting", enforced: false },
  { routeLabel: "webhooks/telnyx/messaging", enforced: false },
]

export function webhookSignatureAlertKey(routeLabel: string): string {
  return `telnyx-webhook-signature:${routeLabel}`
}

/**
 * Record a signature failure for `routeLabel` and page admins if this is a new problem or the
 * cooldown has passed. Fire-and-forget from callers — never throws, so a webhook handler's
 * response is never blocked or broken by alert delivery.
 */
export async function alertOnInvalidTelnyxSignature(routeLabel: string, enforced: boolean): Promise<void> {
  try {
    const alertKey = webhookSignatureAlertKey(routeLabel)
    const { shouldAlert, eventCount, firstEventAt } = await recordWebhookSignatureFailure(alertKey)
    if (!shouldAlert) return

    const admins = await listPlatformAdminContacts()
    if (admins.length === 0) return

    const sinceLabel = firstEventAt
      ? new Date(firstEventAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "just now"
    const impact = enforced
      ? "Requests are being REJECTED (401) — this may mean real calls/texts are being dropped."
      : "Not yet blocking requests (still warn-only), but check whether this is expected traffic."
    const text = `Lyncr alert: Telnyx webhook signature failed on ${routeLabel} (${eventCount}x since ${sinceLabel}). ${impact}`

    await Promise.all(admins.map((user) => deliverPlatformHealthAlert({ user, text })))
    await markWebhookSignatureAlertSent(alertKey)
  } catch (e) {
    console.error("[telnyx-webhook-alerts] failed to send alert:", e)
  }
}
