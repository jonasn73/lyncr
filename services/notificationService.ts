// Real-time in-app alerts for carrier (10DLC) registration outcomes.
// Dispatches Pusher owner-channel events the dashboard bell + SMS banner listen for.

import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

/** High-level outcome we surface to the business owner. */
export type TenDlcNotificationOutcome = "approved" | "rejected" | "pending"

export type TenDlcNotificationPayload = {
  // Workspace owner who should see the alert.
  ownerUserId: string
  // Active organization UUID (null for legacy single-workspace accounts).
  organizationId: string | null
  // approved | rejected | pending
  outcome: TenDlcNotificationOutcome
  // Exact carrier failure text when outcome is rejected.
  failureReason?: string | null
  // Telnyx event type that triggered this alert (for logs / client debugging).
  eventType?: string | null
  // Brand / campaign ids when known.
  brandId?: string | null
  campaignId?: string | null
}

/** Copy shown on successful brand/campaign approval. */
export const TEN_DLC_APPROVED_MESSAGE =
  "🎉 Success! Your 10DLC brand registration has been fully approved by the carriers. Outbound SMS is now fully active."

/** Copy shown when carriers reject registration — includes the fixable reason. */
export function tenDlcRejectedMessage(failureReason: string | null | undefined): string {
  // Prefer the carrier's exact reason; fall back to a generic nudge.
  const reason = (failureReason ?? "").trim() || "a verification issue"
  return `❌ 10DLC Registration Action Required: Your brand was rejected due to ${reason}. Click here to update your business details and re-submit.`
}

/** Build the human-readable title + body for the notification center / toast. */
export function buildTenDlcNotificationCopy(
  outcome: TenDlcNotificationOutcome,
  failureReason?: string | null
): { title: string; message: string; priority: "high" | "normal" } {
  if (outcome === "approved") {
    return {
      title: "10DLC approved",
      message: TEN_DLC_APPROVED_MESSAGE,
      priority: "normal",
    }
  }
  if (outcome === "rejected") {
    return {
      title: "10DLC action required",
      message: tenDlcRejectedMessage(failureReason),
      priority: "high",
    }
  }
  return {
    title: "10DLC update",
    message: "Your 10DLC registration is still under carrier review.",
    priority: "normal",
  }
}

/**
 * Push a real-time 10DLC status alert to the owner dashboard.
 * Safe no-op when Pusher is not configured.
 */
export async function notifyTenDlcStatusChange(
  input: TenDlcNotificationPayload
): Promise<{ published: boolean; title: string; message: string }> {
  // Resolve display copy from the outcome + optional failure reason.
  const copy = buildTenDlcNotificationCopy(input.outcome, input.failureReason)

  // Fan out on the owner + workspace Pusher channels.
  const published = await publishOwnerEvent(input.ownerUserId, "10dlc-update", {
    organization_id: input.organizationId,
    outcome: input.outcome,
    status: input.outcome,
    title: copy.title,
    message: copy.message,
    failure_reason: input.failureReason?.trim() || null,
    event_type: input.eventType ?? null,
    brand_id: input.brandId ?? null,
    campaign_id: input.campaignId ?? null,
    priority: copy.priority,
    // Clients open the carrier registration modal when rejected.
    action: input.outcome === "rejected" ? "open_carrier_registration" : "refresh_compliance",
  })

  // Always log so Vercel runtime logs show carrier outcomes even without Pusher.
  console.log(
    JSON.stringify({
      lyncr: "notificationService.10dlc",
      ownerUserId: input.ownerUserId,
      organizationId: input.organizationId,
      outcome: input.outcome,
      published,
      eventType: input.eventType ?? null,
      failureReason: input.failureReason ?? null,
    })
  )

  return { published, title: copy.title, message: copy.message }
}
