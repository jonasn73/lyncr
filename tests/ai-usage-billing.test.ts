import { describe, expect, it, vi, beforeEach } from "vitest"

const getOnboardingProfile = vi.fn()
const meterEventsCreate = vi.fn()
const isStripeConfigured = vi.fn(() => true)

vi.mock("@/lib/db", () => ({
  getOnboardingProfile: (...args: unknown[]) => getOnboardingProfile(...args),
}))

vi.mock("@/lib/stripe-config", () => ({
  getStripeClient: () => ({
    billing: { meterEvents: { create: (...args: unknown[]) => meterEventsCreate(...args) } },
  }),
  isStripeConfigured: () => isStripeConfigured(),
}))

import { reportAiAssistantMinutesUsage } from "@/lib/ai-usage-billing"

beforeEach(() => {
  vi.clearAllMocks()
  isStripeConfigured.mockReturnValue(true)
  getOnboardingProfile.mockResolvedValue({ stripe_customer_id: "cus_123" })
  meterEventsCreate.mockResolvedValue({})
})

describe("reportAiAssistantMinutesUsage (087)", () => {
  it("rounds seconds up to whole minutes and reports to the Stripe meter", async () => {
    await reportAiAssistantMinutesUsage("user-1", 61, "cc-1")

    expect(meterEventsCreate).toHaveBeenCalledTimes(1)
    const params = meterEventsCreate.mock.calls[0][0]
    expect(params.event_name).toBe("ai_assistant_minutes")
    expect(params.payload).toEqual({ stripe_customer_id: "cus_123", value: "2" })
    expect(params.identifier).toBe("cc-1")
  })

  it("no-ops when the account has no Stripe customer id yet", async () => {
    getOnboardingProfile.mockResolvedValue({ stripe_customer_id: null })
    await reportAiAssistantMinutesUsage("user-1", 90)
    expect(meterEventsCreate).not.toHaveBeenCalled()
  })

  it("no-ops when Stripe isn't configured", async () => {
    isStripeConfigured.mockReturnValue(false)
    await reportAiAssistantMinutesUsage("user-1", 90)
    expect(meterEventsCreate).not.toHaveBeenCalled()
    expect(getOnboardingProfile).not.toHaveBeenCalled()
  })

  it("no-ops on zero or negative seconds", async () => {
    await reportAiAssistantMinutesUsage("user-1", 0)
    await reportAiAssistantMinutesUsage("user-1", -5)
    expect(meterEventsCreate).not.toHaveBeenCalled()
  })

  it("swallows a Stripe error instead of throwing (never blocks call cleanup)", async () => {
    meterEventsCreate.mockRejectedValue(new Error("meter not found"))
    await expect(reportAiAssistantMinutesUsage("user-1", 90)).resolves.toBeUndefined()
  })
})
