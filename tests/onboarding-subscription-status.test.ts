import { describe, expect, it } from "vitest"
import {
  isVerifiedActiveSubscription,
  shouldShowSandboxTrialBanner,
} from "@/lib/onboarding-subscription-status"

describe("shouldShowSandboxTrialBanner", () => {
  it("hides sandbox when the Telnyx line is already carrier-live (cancelled sub false positive)", () => {
    expect(
      shouldShowSandboxTrialBanner({
        reservedDisplay: "(502) 557-1219",
        subscriptionActive: false,
        carrierLive: true,
      })
    ).toBe(false)
  })

  it("shows sandbox when a reserved number exists but payment and carrier are both inactive", () => {
    expect(
      shouldShowSandboxTrialBanner({
        reservedDisplay: "(502) 557-1219",
        subscriptionActive: false,
        carrierLive: false,
      })
    ).toBe(true)
  })

  it("hides sandbox when subscription is verified", () => {
    expect(
      shouldShowSandboxTrialBanner({
        reservedDisplay: "(502) 557-1219",
        subscriptionActive: true,
        carrierLive: false,
      })
    ).toBe(false)
  })

  it("hides sandbox when there is no reserved line yet", () => {
    expect(
      shouldShowSandboxTrialBanner({
        reservedDisplay: null,
        subscriptionActive: false,
        carrierLive: false,
      })
    ).toBe(false)
  })
})

describe("isVerifiedActiveSubscription", () => {
  it("stays false when Stripe cancelled even if the DID is still live", () => {
    expect(
      isVerifiedActiveSubscription(
        {
          has_active_subscription: false,
          stripe_subscription_id: "sub_cancelled",
        },
        true
      )
    ).toBe(false)
  })
})
