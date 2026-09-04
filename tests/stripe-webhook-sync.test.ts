import { describe, expect, it, vi, beforeEach } from "vitest"
import type Stripe from "stripe"

const updateOnboardingProfile = vi.fn()
const applySubscriptionTierToUser = vi.fn()

vi.mock("@/lib/db", () => ({
  adjustUserCarrierCredit: vi.fn(),
  getOnboardingProfile: vi.fn(() => Promise.resolve(null)),
  getPhoneNumbers: vi.fn(() => Promise.resolve([])),
  getUser: vi.fn(() => Promise.resolve(null)),
  insertPhoneNumber: vi.fn(),
  normalizePhoneNumberE164: (p: string) => p,
  syncOnboardingLineToPhoneNumbers: vi.fn(),
  updateOnboardingProfile: (...args: unknown[]) => updateOnboardingProfile(...args),
  updatePhoneNumber: vi.fn(),
}))

vi.mock("@/lib/stripe-billing-sync", () => ({
  applySubscriptionTierToUser: (...args: unknown[]) => applySubscriptionTierToUser(...args),
}))

vi.mock("@/lib/telnyx-purchase-line", () => ({
  purchaseAndConfigureTelnyxLine: vi.fn(),
}))

vi.mock("@/lib/number-allocation", () => ({
  evaluateNumberProvisionGate: vi.fn(),
}))

import {
  syncStripeSubscriptionToNeon,
  handleStripeSubscriptionDeleted,
} from "@/lib/stripe-webhook-sync"

function fakeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_123",
    status: "active",
    customer: "cus_123",
    current_period_start: Math.floor(Date.now() / 1000) - 86_400,
    current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 29,
    items: { data: [] },
    metadata: {},
    ...overrides,
  } as unknown as Stripe.Subscription
}

beforeEach(() => {
  vi.clearAllMocks()
  updateOnboardingProfile.mockResolvedValue({})
  applySubscriptionTierToUser.mockResolvedValue(undefined)
})

describe("syncStripeSubscriptionToNeon — non-live transitions reset the tier (087/billing gap)", () => {
  it("resets subscription_tier to free_trial when a subscription is canceled", async () => {
    await syncStripeSubscriptionToNeon("user-1", fakeSubscription({ status: "canceled" }))

    expect(updateOnboardingProfile).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ has_active_subscription: false, subscription_tier: "free_trial" })
    )
    expect(applySubscriptionTierToUser).toHaveBeenCalledWith("user-1", "free_trial")
  })

  it("resets subscription_tier to free_trial when a subscription becomes unpaid (payment failure exhausted retries)", async () => {
    await syncStripeSubscriptionToNeon("user-1", fakeSubscription({ status: "unpaid" }))

    expect(updateOnboardingProfile).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ subscription_tier: "free_trial" })
    )
    expect(applySubscriptionTierToUser).toHaveBeenCalledWith("user-1", "free_trial")
  })

  it("is idempotent — a second cancellation event does not throw and downgrades again harmlessly", async () => {
    const sub = fakeSubscription({ status: "canceled" })
    await syncStripeSubscriptionToNeon("user-1", sub)
    await syncStripeSubscriptionToNeon("user-1", sub)

    expect(applySubscriptionTierToUser).toHaveBeenCalledTimes(2)
    expect(applySubscriptionTierToUser).toHaveBeenNthCalledWith(2, "user-1", "free_trial")
  })

  it("does not downgrade a live (active) subscription", async () => {
    await syncStripeSubscriptionToNeon("user-1", fakeSubscription({ status: "active" }))

    expect(applySubscriptionTierToUser).not.toHaveBeenCalledWith("user-1", "free_trial")
  })
})

describe("handleStripeSubscriptionDeleted delegates to the fixed sync path", () => {
  it("resets the tier via syncStripeSubscriptionToNeon instead of its own has_active_subscription-only write", async () => {
    await handleStripeSubscriptionDeleted(
      fakeSubscription({ status: "canceled", metadata: { user_id: "user-2" } })
    )

    expect(updateOnboardingProfile).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({ has_active_subscription: false, subscription_tier: "free_trial" })
    )
    expect(applySubscriptionTierToUser).toHaveBeenCalledWith("user-2", "free_trial")
  })
})
