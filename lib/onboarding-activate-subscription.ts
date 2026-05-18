import {
  updateOnboardingProfile,
  getOnboardingProfile,
  provisionOnboardingBuyLine,
} from "@/lib/db"
import { isReservedLineCarrierLive } from "@/lib/onboarding-line-carrier-status"
import type { OnboardingProfile } from "@/lib/types"

/**
 * Checkout activation — attempts Telnyx provision first.
 * `has_active_subscription` is set true only when the carrier owns the DID (SID on file).
 */
export async function activateOnboardingSubscription(userId: string): Promise<OnboardingProfile> {
  const existing = await getOnboardingProfile(userId)
  if (!existing?.reserved_number?.trim()) {
    throw new Error("Reserve a business line before activating.")
  }
  if (existing.has_active_subscription) {
    return existing
  }

  try {
    await provisionOnboardingBuyLine(userId, existing)
  } catch (e) {
    console.error("[activateOnboardingSubscription] provision:", e)
    throw e instanceof Error ? e : new Error("Could not start Telnyx provisioning.")
  }

  const carrierLive = await isReservedLineCarrierLive(userId, existing.reserved_number)
  if (!carrierLive) {
    return existing
  }

  return updateOnboardingProfile(userId, { has_active_subscription: true })
}
