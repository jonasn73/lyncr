import {
  updateOnboardingProfile,
  getOnboardingProfile,
  provisionOnboardingBuyLine,
} from "@/lib/db"
import type { OnboardingProfile } from "@/lib/types"

type ActivateSubscriptionOpts = {
  /** First-time card entry from dashboard modal — persist billing method + activate. */
  saveBillingMethod?: boolean
}

/**
 * Completes line activation after billing is on file.
 * Sets `has_active_subscription` when billing was collected at onboarding or via modal.
 */
export async function activateOnboardingSubscription(
  userId: string,
  opts?: ActivateSubscriptionOpts
): Promise<OnboardingProfile> {
  const existing = await getOnboardingProfile(userId)
  if (!existing?.reserved_number?.trim()) {
    throw new Error("Reserve a business line before activating.")
  }
  if (existing.has_active_subscription) {
    return existing
  }

  const billingReady = existing.has_billing_method || opts?.saveBillingMethod === true
  if (!billingReady) {
    throw new Error("Add a payment method to activate your line.")
  }

  try {
    await provisionOnboardingBuyLine(userId, existing)
  } catch (e) {
    console.error("[activateOnboardingSubscription] provision:", e)
    throw e instanceof Error ? e : new Error("Could not start Telnyx provisioning.")
  }

  return updateOnboardingProfile(userId, {
    has_active_subscription: true,
    ...(opts?.saveBillingMethod ? { has_billing_method: true } : {}),
  })
}
