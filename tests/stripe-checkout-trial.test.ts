import { describe, expect, it, vi, beforeEach } from "vitest"

const getOnboardingProfile = vi.fn()
const getUser = vi.fn()
const sessionsCreate = vi.fn()
const resolveStripeAiMinutesPriceId = vi.fn()

vi.mock("@/lib/db", () => ({
  getOnboardingProfile: (...args: unknown[]) => getOnboardingProfile(...args),
  getUser: (...args: unknown[]) => getUser(...args),
}))

vi.mock("@/lib/telnyx", () => ({
  getAppUrl: () => "https://lyncr.app",
}))

vi.mock("@/lib/stripe-config", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: (...args: unknown[]) => sessionsCreate(...args) } },
  }),
  resolveStripePriceIdForTier: vi.fn(() => Promise.resolve("price_starter_123")),
  resolveStripeAiMinutesPriceId: (...args: unknown[]) => resolveStripeAiMinutesPriceId(...args),
}))

import { createLyncrSubscriptionCheckout } from "@/lib/stripe-checkout"

beforeEach(() => {
  vi.clearAllMocks()
  getOnboardingProfile.mockResolvedValue({
    reserved_number: "+15025551219",
    reserved_number_display: "(502) 555-1219",
    stripe_subscription_id: null,
  })
  getUser.mockResolvedValue({ email: "owner@example.com" })
  sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session_123", id: "cs_123" })
  // Unset by default — AI-minutes metered price is optional (087) and not yet configured.
  resolveStripeAiMinutesPriceId.mockResolvedValue(null)
})

describe("createLyncrSubscriptionCheckout — real 14-day trial (billing gap fix)", () => {
  it("sets a 14-day trial period on every new subscription checkout", async () => {
    await createLyncrSubscriptionCheckout("user-1", "starter")

    expect(sessionsCreate).toHaveBeenCalledTimes(1)
    const params = sessionsCreate.mock.calls[0][0]
    expect(params.mode).toBe("subscription")
    expect(params.subscription_data.trial_period_days).toBe(14)
  })

  it("does not add an AI-minutes line item when the metered price isn't configured yet", async () => {
    await createLyncrSubscriptionCheckout("user-1", "professional")
    const params = sessionsCreate.mock.calls[0][0]
    expect(params.line_items).toHaveLength(1)
  })

  it("adds the AI-minutes metered line item once the price is configured (087)", async () => {
    resolveStripeAiMinutesPriceId.mockResolvedValue("price_ai_minutes_pro")

    await createLyncrSubscriptionCheckout("user-1", "professional")

    const params = sessionsCreate.mock.calls[0][0]
    expect(params.line_items).toEqual([
      { price: "price_starter_123", quantity: 1 },
      { price: "price_ai_minutes_pro" },
    ])
  })

  it("still requires a reserved line before allowing checkout (no free number without one)", async () => {
    getOnboardingProfile.mockResolvedValue({ reserved_number: null, stripe_subscription_id: null })

    await expect(createLyncrSubscriptionCheckout("user-1", "starter")).rejects.toThrow(
      /reserve a business line/i
    )
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("refuses to start a second checkout for an already-subscribed account", async () => {
    getOnboardingProfile.mockResolvedValue({
      reserved_number: "+15025551219",
      stripe_subscription_id: "sub_existing",
    })

    await expect(createLyncrSubscriptionCheckout("user-1", "professional")).rejects.toThrow(
      /already have an active subscription/i
    )
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})
