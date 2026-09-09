// Shared 10DLC campaign architecture — assign tenant local DIDs to Lyncr's platform campaign.

import { getMessaging10DlcRegistration, normalizePhoneNumberE164 } from "@/lib/db"
import { assignNumberToTelnyx10DlcCampaign } from "@/lib/telnyx-10dlc"
import { configureNumberMessaging } from "@/lib/telnyx-messaging-config"

const US_TOLL_FREE_NPA = new Set(["800", "888", "877", "866", "855", "844", "833"])

/** Verified master Platform Campaign ID from Telnyx Mission Control (env). */
export function getPlatform10DlcCampaignId(): string | null {
  return process.env.TELNYX_PLATFORM_10DLC_CAMPAIGN_ID?.trim() || null
}

/** True for US geographic (+1) lines that require 10DLC (not toll-free). */
export function isUsLocalDid(e164: string): boolean {
  const normalized = normalizePhoneNumberE164(e164.trim())
  if (!normalized.startsWith("+1") || normalized.length !== 12) return false
  const npa = normalized.slice(2, 5)
  return !US_TOLL_FREE_NPA.has(npa)
}

export type SharedCampaignProvisionResult = {
  phone_number: string
  messaging_profile_assigned: boolean
  campaign_assigned: boolean
  campaign_id: string | null
  skipped_reason?: string
  error?: string
}

/**
 * Shared Campaign Architecture Pattern:
 * 1) Attach DID to platform messaging profile (inbound/outbound SMS webhooks)
 * 2) Assign DID to Lyncr's verified master 10DLC campaign (skip per-tenant TCR registration)
 */
export async function provisionLocalDidOnSharedPlatformCampaign(
  phoneNumberE164: string
): Promise<SharedCampaignProvisionResult> {
  const phone = normalizePhoneNumberE164(phoneNumberE164.trim())
  const campaignId = getPlatform10DlcCampaignId()

  if (!isUsLocalDid(phone)) {
    return {
      phone_number: phone,
      messaging_profile_assigned: false,
      campaign_assigned: false,
      campaign_id: campaignId,
      skipped_reason: "not_us_local_did",
    }
  }

  let messagingAssigned = false
  let campaignAssigned = false

  try {
    await configureNumberMessaging(phone)
    messagingAssigned = true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      phone_number: phone,
      messaging_profile_assigned: false,
      campaign_assigned: false,
      campaign_id: campaignId,
      error: `Messaging profile: ${msg}`,
    }
  }

  if (!campaignId) {
    return {
      phone_number: phone,
      messaging_profile_assigned: messagingAssigned,
      campaign_assigned: false,
      campaign_id: null,
      skipped_reason: "TELNYX_PLATFORM_10DLC_CAMPAIGN_ID not configured",
    }
  }

  const assign = await assignNumberToTelnyx10DlcCampaign(phone, campaignId)
  if (!assign.ok) {
    return {
      phone_number: phone,
      messaging_profile_assigned: messagingAssigned,
      campaign_assigned: false,
      campaign_id: campaignId,
      error: assign.error,
    }
  }

  campaignAssigned = true
  console.log(
    JSON.stringify({
      lyncr: "shared-10dlc-campaign-assigned",
      phone_number: phone,
      campaign_id: campaignId,
    })
  )

  return {
    phone_number: phone,
    messaging_profile_assigned: messagingAssigned,
    campaign_assigned: campaignAssigned,
    campaign_id: campaignId,
  }
}

/**
 * Provision a newly purchased/ported line for SMS, org-aware.
 *
 * Tries the platform shared campaign first (no-op today — TELNYX_PLATFORM_10DLC_CAMPAIGN_ID
 * isn't set). Falls back to the workspace's own already-approved 10DLC campaign, if it has
 * one, so a second/third line an owner buys after finishing 10DLC rides on the same approved
 * campaign instead of silently going unassigned (carriers accept the message from Telnyx but
 * then drop it — no error, it just never arrives).
 */
export async function provisionLocalDidFor10Dlc(
  userId: string,
  organizationId: string | null | undefined,
  phoneNumberE164: string
): Promise<SharedCampaignProvisionResult> {
  const shared = await provisionLocalDidOnSharedPlatformCampaign(phoneNumberE164)
  if (shared.campaign_assigned || shared.skipped_reason === "not_us_local_did" || shared.error) {
    return shared
  }

  try {
    const registration = await getMessaging10DlcRegistration(userId, organizationId ?? null)
    if (registration?.status !== "approved" || !registration.campaign_id) {
      return shared
    }
    const assign = await assignNumberToTelnyx10DlcCampaign(shared.phone_number, registration.campaign_id)
    if (!assign.ok) {
      return { ...shared, error: `Workspace campaign: ${assign.error}` }
    }
    return {
      ...shared,
      campaign_assigned: true,
      campaign_id: registration.campaign_id,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...shared, error: `Workspace campaign lookup failed: ${msg}` }
  }
}
