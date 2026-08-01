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

/**
 * "Sandbox mode" alert: reserved number exists but the line is not paid AND not carrier-live.
 * Do not show when Telnyx already has an active DID — that is Live & Connected, not sandbox
 * (e.g. Stripe cancel flips has_active_subscription=false while the number stays active).
 */
export function shouldShowSandboxTrialBanner(opts: {
  reservedDisplay: string | null | undefined
  subscriptionActive: boolean
  carrierLive: boolean
}): boolean {
  const hasReserved = Boolean(opts.reservedDisplay?.trim())
  if (!hasReserved) return false
  if (opts.carrierLive) return false
  return !opts.subscriptionActive
}

/** True when Stripe Checkout is not needed — customer already has a paid subscription id. */
export function hasPaidStripeSubscription(
  profile: Pick<OnboardingProfile, "stripe_subscription_id"> | null | undefined
): boolean {
  return Boolean(profile?.stripe_subscription_id?.trim())
}

/** User still needs to complete Stripe payment (not sim-only `has_active_subscription`). */
export function needsStripeSubscriptionCheckout(
  profile: Pick<
    OnboardingProfile,
    "has_active_subscription" | "stripe_subscription_id"
  > | null | undefined,
  carrierLive: boolean
): boolean {
  if (carrierLive) return false
  if (hasPaidStripeSubscription(profile)) return false
  return true
}

/** Paid subscription exists but the carrier line is not live yet. */
export function needsLineProvisioning(
  profile: Pick<
    OnboardingProfile,
    "has_active_subscription" | "stripe_subscription_id"
  > | null | undefined,
  carrierLive: boolean
): boolean {
  return isVerifiedActiveSubscription(profile, carrierLive) && !carrierLive
}
