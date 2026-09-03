import { describe, expect, it, vi, beforeEach } from "vitest"

const getUser = vi.fn()
const getOnboardingProfile = vi.fn()

vi.mock("@/lib/db", () => ({
  getUser: (...args: unknown[]) => getUser(...args),
  getOnboardingProfile: (...args: unknown[]) => getOnboardingProfile(...args),
}))

import { resolveAiVoiceAssistantEntitlement } from "@/lib/ai-voice-entitlement"

beforeEach(() => {
  getUser.mockReset()
  getOnboardingProfile.mockReset()
})

describe("resolveAiVoiceAssistantEntitlement (087)", () => {
  it("blocks free-trial and starter accounts", async () => {
    getUser.mockResolvedValue({ email: "owner@example.com" })
    getOnboardingProfile.mockResolvedValue({ subscription_tier: "starter" })
    const result = await resolveAiVoiceAssistantEntitlement("user-1")
    expect(result).toEqual({ tier: "starter", allowed: false })
  })

  it("allows professional and business accounts", async () => {
    getUser.mockResolvedValue({ email: "owner@example.com" })
    getOnboardingProfile.mockResolvedValue({ subscription_tier: "professional" })
    const result = await resolveAiVoiceAssistantEntitlement("user-1")
    expect(result).toEqual({ tier: "professional", allowed: true })
  })

  it("always allows the master QA account regardless of tier", async () => {
    getUser.mockResolvedValue({ email: "jonasn73@gmail.com" })
    getOnboardingProfile.mockResolvedValue({ subscription_tier: "free_trial" })
    const result = await resolveAiVoiceAssistantEntitlement("user-1")
    expect(result.allowed).toBe(true)
  })

  it("fails closed (not allowed) with no userId", async () => {
    const result = await resolveAiVoiceAssistantEntitlement("")
    expect(result.allowed).toBe(false)
    expect(getUser).not.toHaveBeenCalled()
  })
})
