// Process Telnyx 10DLC brand/campaign webhooks: update DB + fire owner notifications.

import { NextResponse } from "next/server"
import {
  getMessaging10DlcRegistrationByBrandId,
  getMessaging10DlcRegistrationByCampaignId,
  upsertMessaging10DlcRegistration,
} from "@/lib/db"
import {
  markWorkspaceSmsRegistrationApproved,
  markWorkspaceSmsRegistrationRejected,
  refreshMessaging10DlcStatus,
} from "@/lib/messaging-10dlc"
import { getTelnyx10DlcBrandStatus } from "@/lib/telnyx-10dlc"
import {
  isTelnyx10DlcWebhookEvent,
  parseTelnyx10DlcWebhook,
  resolveTenDlcWebhookOutcome,
  type TenDlcWebhookOutcome,
} from "@/lib/telnyx-10dlc-webhook"
import { notifyTenDlcStatusChange } from "@/services/notificationService"
import type { Messaging10DlcRegistration } from "@/lib/types"

async function findRegistrationForWebhook(parsed: {
  brandId: string | null
  campaignId: string | null
}): Promise<Messaging10DlcRegistration | null> {
  if (parsed.brandId) {
    const byBrand = await getMessaging10DlcRegistrationByBrandId(parsed.brandId)
    if (byBrand) return byBrand
  }
  if (parsed.campaignId) {
    const byCampaign = await getMessaging10DlcRegistrationByCampaignId(parsed.campaignId)
    if (byCampaign) return byCampaign
  }
  return null
}

/** Enrich brand outcome with a live Telnyx brand GET when the webhook omitted identityStatus. */
async function enrichBrandIdentity(
  parsed: ReturnType<typeof parseTelnyx10DlcWebhook>
): Promise<ReturnType<typeof parseTelnyx10DlcWebhook>> {
  const isBrandEvent =
    parsed.eventType.toLowerCase().includes("brand") || Boolean(parsed.brandId && !parsed.campaignId)
  if (!isBrandEvent || !parsed.brandId) return parsed
  if (parsed.identityStatus && parsed.failureReason) return parsed

  const live = await getTelnyx10DlcBrandStatus(parsed.brandId)
  if (!live) return parsed
  return {
    ...parsed,
    identityStatus: parsed.identityStatus || live.raw || null,
    failureReason: parsed.failureReason || live.detail || null,
  }
}

async function applyApproved(
  reg: Messaging10DlcRegistration,
  statusCode: string | null
): Promise<Messaging10DlcRegistration> {
  const orgId = reg.organization_id
  const baseDetail =
    "Approved — your 10DLC brand registration has been fully approved by the carriers. Outbound SMS is now fully active."
  const detail = statusCode ? `${baseDetail} (${statusCode})` : baseDetail

  const updated = await upsertMessaging10DlcRegistration(
    reg.user_id,
    {
      status: "approved",
      status_detail: detail,
      brand_id: reg.brand_id,
      campaign_id: reg.campaign_id,
    },
    orgId
  )

  if (orgId && !orgId.startsWith("legacy-")) {
    await markWorkspaceSmsRegistrationApproved(reg.user_id, orgId)
  }

  // Best-effort: assign the business line now that carriers approved.
  await refreshMessaging10DlcStatus(reg.user_id, orgId).catch((e) => {
    console.warn("[10dlc webhook] post-approval refresh failed:", e)
  })

  return updated
}

async function applyRejected(
  reg: Messaging10DlcRegistration,
  failureReason: string | null,
  statusCode: string | null
): Promise<Messaging10DlcRegistration> {
  const orgId = reg.organization_id
  const reason =
    (failureReason ?? "").trim() ||
    "Brand identity could not be verified. Update your business details and resubmit."
  const detail = statusCode ? `${reason} Carrier code: ${statusCode}.` : reason

  const updated = await upsertMessaging10DlcRegistration(
    reg.user_id,
    {
      status: "rejected",
      status_detail: detail,
      brand_id: reg.brand_id,
      campaign_id: reg.campaign_id,
    },
    orgId
  )

  if (orgId && !orgId.startsWith("legacy-")) {
    await markWorkspaceSmsRegistrationRejected(reg.user_id, orgId)
  }

  return updated
}

async function applyPending(
  reg: Messaging10DlcRegistration,
  statusCode: string | null
): Promise<Messaging10DlcRegistration> {
  return upsertMessaging10DlcRegistration(
    reg.user_id,
    {
      status: "pending_review",
      status_detail:
        reg.status_detail?.trim() ||
        `Carrier review in progress${statusCode ? ` (${statusCode})` : ""}. This usually takes 5–10 business days.`,
      brand_id: reg.brand_id,
      campaign_id: reg.campaign_id,
    },
    reg.organization_id
  )
}

/**
 * Handle a Telnyx 10DLC webhook body.
 * Always ACKs 200 when the event type is recognized so Telnyx does not retry forever.
 */
export async function processTelnyx10DlcWebhook(body: Record<string, unknown>): Promise<Response> {
  let parsed = parseTelnyx10DlcWebhook(body)
  if (!isTelnyx10DlcWebhookEvent(parsed.eventType)) {
    return NextResponse.json({ received: true, handled: false, reason: "not_10dlc_event" })
  }

  parsed = await enrichBrandIdentity(parsed)
  const resolved = resolveTenDlcWebhookOutcome(parsed)
  const outcome: TenDlcWebhookOutcome = resolved.outcome

  const reg = await findRegistrationForWebhook(parsed)
  if (!reg) {
    console.warn(
      JSON.stringify({
        lyncr: "telnyx-10dlc-webhook",
        unmatched: true,
        eventType: parsed.eventType,
        brandId: parsed.brandId,
        campaignId: parsed.campaignId,
        outcome,
      })
    )
    return NextResponse.json({
      received: true,
      handled: false,
      reason: "registration_not_found",
      event_type: parsed.eventType,
      brand_id: parsed.brandId,
      campaign_id: parsed.campaignId,
    })
  }

  let registration = reg
  if (outcome === "approved") {
    registration = await applyApproved(reg, resolved.statusCode)
  } else if (outcome === "rejected") {
    registration = await applyRejected(reg, resolved.failureReason, resolved.statusCode)
  } else if (outcome === "pending") {
    registration = await applyPending(reg, resolved.statusCode)
  }

  let notification: { published: boolean; title: string; message: string } | null = null
  if (outcome === "approved" || outcome === "rejected") {
    notification = await notifyTenDlcStatusChange({
      ownerUserId: reg.user_id,
      organizationId: reg.organization_id,
      outcome,
      failureReason: resolved.failureReason,
      eventType: parsed.eventType,
      brandId: parsed.brandId ?? reg.brand_id,
      campaignId: parsed.campaignId ?? reg.campaign_id,
    })
  }

  console.log(
    JSON.stringify({
      lyncr: "telnyx-10dlc-webhook",
      userId: reg.user_id,
      organizationId: reg.organization_id,
      eventType: parsed.eventType,
      eventId: parsed.eventId,
      brandId: parsed.brandId,
      campaignId: parsed.campaignId,
      outcome,
      statusCode: resolved.statusCode,
      failureReason: resolved.failureReason,
      registrationStatus: registration.status,
      notificationPublished: notification?.published ?? false,
    })
  )

  return NextResponse.json({
    received: true,
    handled: outcome !== "ignored",
    event_type: parsed.eventType,
    outcome,
    organization_id: reg.organization_id,
    registration_status: registration.status,
    failure_reason: resolved.failureReason,
    notification_published: notification?.published ?? false,
  })
}
