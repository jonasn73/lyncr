// When a Telnyx LNP port reaches "Live on Lyncr", activate voice + SMS on the line.

import {
  getPhoneNumberByNumberAndStatus,
  getCompletedPortingOrderForPhone,
  insertPhoneNumber,
  listCompletedPortPhoneNumbersForOwner,
  normalizePhoneNumberE164,
  updatePhoneNumber,
} from "@/lib/db"
import { configureNumberMessaging } from "@/lib/telnyx-messaging-config"
import { provisionLocalDidOnSharedPlatformCampaign } from "@/lib/telnyx-shared-campaign"
import { configureNumberVoice, findTelnyxPhoneNumberId, getOrCreateTexmlApp } from "@/lib/telnyx-config"
import { promotePortedLineAsPrimary } from "@/lib/port-line-promotion"

export type FinalizePortedNumberResult = {
  ok: boolean
  phone_number: string
  voice_configured: boolean
  messaging_configured: boolean
  activated: boolean
  promoted_primary: boolean
  error?: string
}

/**
 * Idempotent: mark the line active, attach TeXML voice routing, assign messaging,
 * and promote the ported DID as the workspace main customer number.
 */
export async function finalizePortedNumber(params: {
  ownerUserId: string
  phoneNumberE164: string
  telnyxOrderId?: string | null
  organizationId?: string | null
}): Promise<FinalizePortedNumberResult> {
  const e164 = normalizePhoneNumberE164(params.phoneNumberE164.trim())
  if (!e164) {
    return {
      ok: false,
      phone_number: "",
      voice_configured: false,
      messaging_configured: false,
      activated: false,
      promoted_primary: false,
      error: "invalid_number",
    }
  }

  let voiceConfigured = false
  let messagingConfigured = false
  let activated = false
  let promotedPrimary = false

  try {
    const telnyxNumberId =
      (await findTelnyxPhoneNumberId(e164)) ||
      params.telnyxOrderId?.trim() ||
      null

    const portingRow = await getPhoneNumberByNumberAndStatus(e164, "porting")
    if (portingRow && portingRow.user_id === params.ownerUserId) {
      await updatePhoneNumber(portingRow.id, params.ownerUserId, {
        status: "active",
        provider_number_sid: telnyxNumberId || portingRow.provider_number_sid,
      })
      activated = true
    } else {
      const activeRow = await getPhoneNumberByNumberAndStatus(e164, "active")
      if (activeRow && activeRow.user_id === params.ownerUserId) {
        if (telnyxNumberId && !activeRow.provider_number_sid?.trim()) {
          await updatePhoneNumber(activeRow.id, params.ownerUserId, {
            provider_number_sid: telnyxNumberId,
          })
        }
        activated = true
      } else {
        const completedPort = await getCompletedPortingOrderForPhone(
          params.ownerUserId,
          e164,
          params.organizationId ?? null
        )
        await insertPhoneNumber({
          user_id: params.ownerUserId,
          organization_id: completedPort?.organization_id ?? params.organizationId ?? null,
          number: e164,
          friendly_name: e164,
          label: "Main Line",
          type: "local",
          status: "active",
          provider_number_sid: telnyxNumberId ?? params.telnyxOrderId?.trim() ?? "",
          source_provider: "telnyx",
        })
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

    promotedPrimary = await promotePortedLineAsPrimary({
      ownerUserId: params.ownerUserId,
      phoneNumberE164: e164,
    })

    console.log(
      JSON.stringify({
        lyncr: "port-finalize",
        userId: params.ownerUserId,
        number: e164,
        activated,
        voice: voiceConfigured,
        messaging: messagingConfigured,
        promoted_primary: promotedPrimary,
      })
    )

    return {
      ok: true,
      phone_number: e164,
      voice_configured: voiceConfigured,
      messaging_configured: messagingConfigured,
      activated,
      promoted_primary: promotedPrimary,
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
      promoted_primary: promotedPrimary,
      error: msg,
    }
  }
}

/** Backfill activation + primary line when porting_orders is completed but phone_numbers lagged. */
export async function reconcileCompletedPortLinesForOwner(params: {
  ownerUserId: string
  organizationId?: string | null
}): Promise<number> {
  const targets = await listCompletedPortPhoneNumbersForOwner(
    params.ownerUserId,
    params.organizationId ?? null
  )
  let fixed = 0
  for (const phone of targets) {
    const porting = await getPhoneNumberByNumberAndStatus(phone, "porting")
    const active = await getPhoneNumberByNumberAndStatus(phone, "active")
    const needsVoice =
      porting ||
      !active ||
      !(active.provider_number_sid?.trim())
    if (needsVoice) {
      const result = await finalizePortedNumber({
        ownerUserId: params.ownerUserId,
        phoneNumberE164: phone,
        organizationId: params.organizationId ?? null,
      })
      if (result.ok) fixed += 1
      continue
    }
    const promoted = await promotePortedLineAsPrimary({
      ownerUserId: params.ownerUserId,
      phoneNumberE164: phone,
    })
    if (promoted) fixed += 1
  }
  return fixed
}
