// Purchase a Telnyx DID and attach it to the Lyncr TeXML call router.

import { getOrCreateTexmlApp, configureNumberVoice, telnyxHeaders, getTelnyxApiKey } from "@/lib/telnyx-config"
import { findPurchasableTelnyxNumber } from "@/lib/telnyx-number-search"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export type PurchaseTelnyxLineResult =
  | { ok: true; phone_number: string; order_id: string }
  | { ok: false; error: string; reason?: "number_unavailable" | "area_empty" | "carrier_error" }

/** Buy `phoneNumberE164` on Telnyx (exact inventory match only) and wire voice to `/api/voice/telnyx/incoming`. */
export async function purchaseAndConfigureTelnyxLine(
  phoneNumberE164: string
): Promise<PurchaseTelnyxLineResult> {
  const requested = phoneNumberE164.trim()
  if (!requested) {
    return { ok: false, error: "Phone number is required" }
  }

  try {
    getTelnyxApiKey()
  } catch {
    return { ok: false, error: "Telnyx is not configured on the server (missing TELNYX_API_KEY)." }
  }

  let target = requested

  try {
    const purchasable = await findPurchasableTelnyxNumber(requested)
    if (!purchasable) {
      return {
        ok: false,
        reason: "area_empty",
        error:
          "No phone numbers are available in this area code right now. Search below and pick a different line.",
      }
    }
    if (purchasable !== requested) {
      return {
        ok: false,
        reason: "number_unavailable",
        error:
          "Your chosen number is no longer available from the carrier. Pick a different line below — you will not be charged until a number is successfully purchased.",
      }
    }
    target = purchasable
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not search Telnyx inventory"
    return { ok: false, error: msg }
  }

  const res = await fetch(`${TELNYX_BASE}/number_orders`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({ phone_numbers: [{ phone_number: target }] }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errMsg =
      (data as { errors?: { detail?: string; title?: string }[] })?.errors?.[0]?.detail ||
      (data as { errors?: { detail?: string; title?: string }[] })?.errors?.[0]?.title ||
      "Telnyx could not purchase this number — it may no longer be available. Search again and pick a different line."
    console.error("[Telnyx] purchase failed:", errMsg, data)
    return { ok: false, reason: "carrier_error", error: String(errMsg) }
  }

  const orderId = String((data as { data?: { id?: string } })?.data?.id || "")
  const boughtNumber =
    String(
      (data as { data?: { phone_numbers?: { phone_number?: string }[] } })?.data?.phone_numbers?.[0]?.phone_number ||
        target
    ) || target

  const texmlAppId = await getOrCreateTexmlApp()
  try {
    await configureNumberVoice(boughtNumber, texmlAppId)
  } catch {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      await configureNumberVoice(boughtNumber, texmlAppId)
    } catch (retryErr) {
      console.error("[Telnyx] voice config failed after retry (number still purchased):", retryErr)
    }
  }

  try {
    const { configureNumberMessaging } = await import("@/lib/telnyx-messaging-config")
    await configureNumberMessaging(boughtNumber)
  } catch (messagingErr) {
    console.error("[Telnyx] messaging profile assignment failed (number still purchased):", messagingErr)
  }

  try {
    const { provisionLocalDidOnSharedPlatformCampaign } = await import("@/lib/telnyx-shared-campaign")
    const shared = await provisionLocalDidOnSharedPlatformCampaign(boughtNumber)
    if (shared.error) {
      console.warn("[Telnyx] shared 10DLC campaign assignment:", shared.error)
    }
  } catch (campaignErr) {
    console.error("[Telnyx] shared 10DLC campaign assignment failed (number still purchased):", campaignErr)
  }

  console.log(`[Telnyx] Purchased and configured ${boughtNumber} (order ${orderId})`)
  return { ok: true, phone_number: boughtNumber, order_id: orderId }
}
