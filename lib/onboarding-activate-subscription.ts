import { updateOnboardingProfile, getOnboardingProfile, provisionOnboardingBuyLine } from "@/lib/db"
import type { OnboardingProfile } from "@/lib/types"

/** Mock Stripe success — sets subscription active and starts Telnyx provision (or simulation sync). */
export async function activateOnboardingSubscription(userId: string): Promise<OnboardingProfile> {
  const existing = await getOnboardingProfile(userId)
  if (!existing?.reserved_number?.trim()) {
    throw new Error("Reserve a business line before activating.")
  }
  if (existing.has_active_subscription) {
    return existing
  }

  const profile = await updateOnboardingProfile(userId, { has_active_subscription: true })
  try {
    await provisionOnboardingBuyLine(userId, profile)
  } catch (e) {
    console.error("[activateOnboardingSubscription] provision:", e)
    throw e instanceof Error ? e : new Error("Could not start Telnyx provisioning.")
  }
  return profile
}
