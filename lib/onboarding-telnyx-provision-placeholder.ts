// ============================================
// Telnyx carrier provisioning placeholder (onboarding)
// ============================================
// Step 1 reserves the DID in Neon. Live Telnyx purchase runs here only when
// ONBOARDING_LIVE_TELNYX_PROVISION=true (typically at launch / billing complete).

import { isOnboardingTelnyxSimulationMode } from "@/lib/onboarding-telnyx-provision-mode"
import { purchaseAndConfigureTelnyxLine } from "@/lib/telnyx-purchase-line"

export type OnboardingTelnyxProvisionResult =
  | { mode: "simulation"; purchased: false }
  | { mode: "live"; purchased: true; phone_number: string; order_id: string }
  | { mode: "live"; purchased: false; error: string }

/**
 * Attempt live Telnyx purchase + TeXML wiring for the reserved onboarding DID.
 * In simulation mode this returns immediately without calling Telnyx.
 */
export async function runOnboardingTelnyxProvisionPlaceholder(
  phoneNumberE164: string
): Promise<OnboardingTelnyxProvisionResult> {
  if (isOnboardingTelnyxSimulationMode()) {
    return { mode: "simulation", purchased: false }
  }

  // ---------------------------------------------------------------------------
  // TODO: Production Telnyx Integration
  // ---------------------------------------------------------------------------
  // When ONBOARDING_LIVE_TELNYX_PROVISION=true, the live path below runs via
  // purchaseAndConfigureTelnyxLine (number_orders + TeXML voice URL).
  //
  // Direct REST example (same outcome as lib/telnyx-purchase-line.ts):
  //
  // const response = await fetch("https://api.telnyx.com/v2/number_orders", {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     phone_numbers: [{ phone_number: phoneNumberE164 }],
  //   }),
  // })
  // const orderBody = await response.json()
  // if (!response.ok) {
  //   const detail = orderBody?.errors?.[0]?.detail ?? "Telnyx purchase failed"
  //   return { mode: "live", purchased: false, error: detail }
  // }
  // const orderId = orderBody?.data?.id
  // const bought = orderBody?.data?.phone_numbers?.[0]?.phone_number ?? phoneNumberE164
  //
  // // Point the DID at Lyncr TeXML (incoming → /api/voice/telnyx/incoming):
  // await fetch(`https://api.telnyx.com/v2/phone_numbers/${telnyxNumberId}/voice`, {
  //   method: "PATCH",
  //   headers: {
  //     Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({ connection_id: texmlApplicationId }),
  // })
  // ---------------------------------------------------------------------------

  const purchase = await purchaseAndConfigureTelnyxLine(phoneNumberE164)
  if (!purchase.ok) {
    return { mode: "live", purchased: false, error: purchase.error }
  }
  return {
    mode: "live",
    purchased: true,
    phone_number: purchase.phone_number,
    order_id: purchase.order_id,
  }
}
