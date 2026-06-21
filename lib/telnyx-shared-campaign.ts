// Shared 10DLC campaign architecture — assign tenant local DIDs to Lyncr's platform campaign.

import { normalizePhoneNumberE164 } from "@/lib/db"
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
