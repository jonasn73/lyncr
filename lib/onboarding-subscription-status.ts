import type { OnboardingProfile } from "@/lib/types"

/**
 * Live UI only when subscription is verified — Stripe sub id on file or Telnyx DID provisioned.
 * Prevents stale `has_active_subscription=true` from mock activations showing LIVE PRODUCTION.
 */
export function isVerifiedActiveSubscription(
  profile: Pick<
    OnboardingProfile,
    "has_active_subscription" | "stripe_subscription_id"
  > | null | undefined,
  carrierLive: boolean
): boolean {
  if (profile?.has_active_subscription !== true) return false
  if (profile.stripe_subscription_id?.trim()) return true
  if (carrierLive) return true
  return false
}
