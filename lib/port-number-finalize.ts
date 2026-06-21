// When a Telnyx LNP port reaches "Live on Lyncr", activate voice + SMS on the line.

import {
  getPhoneNumberByNumberAndStatus,
  normalizePhoneNumberE164,
  updatePhoneNumber,
} from "@/lib/db"
import { configureNumberMessaging } from "@/lib/telnyx-messaging-config"
import { provisionLocalDidOnSharedPlatformCampaign } from "@/lib/telnyx-shared-campaign"
import { configureNumberVoice, getOrCreateTexmlApp } from "@/lib/telnyx-config"

export type FinalizePortedNumberResult = {
  ok: boolean
  phone_number: string
  voice_configured: boolean
  messaging_configured: boolean
  activated: boolean
  error?: string
}

/**
 * Idempotent: mark the line active, attach TeXML voice routing, and assign the
 * platform messaging profile so inbound SMS reaches /api/webhooks/telnyx/messaging.
 */
export async function finalizePortedNumber(params: {
  ownerUserId: string
  phoneNumberE164: string
  telnyxOrderId?: string | null
}): Promise<FinalizePortedNumberResult> {
  const e164 = normalizePhoneNumberE164(params.phoneNumberE164.trim())
  if (!e164) {
    return { ok: false, phone_number: "", voice_configured: false, messaging_configured: false, activated: false, error: "invalid_number" }
  }

  let voiceConfigured = false
  let messagingConfigured = false
  let activated = false

  try {
    const portingRow = await getPhoneNumberByNumberAndStatus(e164, "porting")
    if (portingRow && portingRow.user_id === params.ownerUserId) {
      await updatePhoneNumber(portingRow.id, params.ownerUserId, {
        status: "active",
        provider_number_sid: params.telnyxOrderId?.trim() || portingRow.provider_number_sid,
      })
      activated = true
    } else {
      const activeRow = await getPhoneNumberByNumberAndStatus(e164, "active")
      if (activeRow && activeRow.user_id === params.ownerUserId) {
        activated = true
      }
    }

    const texmlAppId = await getOrCreateTexmlApp()
    await configureNumberVoice(e164, texmlAppId)
    voiceConfigured = true

    await configureNumberMessaging(e164)
    messagingConfigured = true

    const shared = await provisionLocalDidOnSharedPlatformCampaign(e164)
    if (shared.error) {
      console.warn("[port-finalize] shared 10DLC:", shared.error)
    } else if (shared.campaign_assigned) {
      console.log("[port-finalize] shared 10DLC campaign assigned", shared.campaign_id)
    }

    console.log(
      JSON.stringify({
        lyncr: "port-finalize",
        userId: params.ownerUserId,
        number: e164,
        activated,
        voice: voiceConfigured,
        messaging: messagingConfigured,
      })
    )

    return {
      ok: true,
      phone_number: e164,
      voice_configured: voiceConfigured,
      messaging_configured: messagingConfigured,
      activated,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[port-finalize] failed:", { number: e164, error: msg })
    return {
      ok: false,
      phone_number: e164,
      voice_configured: voiceConfigured,
      messaging_configured: messagingConfigured,
      activated,
      error: msg,
    }
  }
}
