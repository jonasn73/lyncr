import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getMessaging10DlcRegistration = vi.fn()
const assignNumberToTelnyx10DlcCampaign = vi.fn()
const configureNumberMessaging = vi.fn()

vi.mock("@/lib/db", () => ({
  getMessaging10DlcRegistration: (...args: unknown[]) => getMessaging10DlcRegistration(...args),
  normalizePhoneNumberE164: (raw: string) => {
    const digits = raw.replace(/[^\d+]/g, "")
    return digits.startsWith("+") ? digits : `+1${digits}`
  },
}))
vi.mock("@/lib/telnyx-10dlc", () => ({
  assignNumberToTelnyx10DlcCampaign: (...args: unknown[]) => assignNumberToTelnyx10DlcCampaign(...args),
}))
vi.mock("@/lib/telnyx-messaging-config", () => ({
  configureNumberMessaging: (...args: unknown[]) => configureNumberMessaging(...args),
}))

import { provisionLocalDidFor10Dlc } from "@/lib/telnyx-shared-campaign"

const originalEnv = { ...process.env }
const NEW_NUMBER = "+15025559999"

beforeEach(() => {
  process.env = { ...originalEnv }
  delete process.env.TELNYX_PLATFORM_10DLC_CAMPAIGN_ID
  getMessaging10DlcRegistration.mockReset()
  assignNumberToTelnyx10DlcCampaign.mockReset()
  configureNumberMessaging.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("provisionLocalDidFor10Dlc", () => {
  it("assigns a new number to the workspace's own approved campaign when no platform campaign is configured", async () => {
    getMessaging10DlcRegistration.mockResolvedValue({
      status: "approved",
      campaign_id: "campaign-approved-123",
    })
    assignNumberToTelnyx10DlcCampaign.mockResolvedValue({ ok: true })

    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", NEW_NUMBER)

    expect(configureNumberMessaging).toHaveBeenCalledWith(NEW_NUMBER)
    expect(getMessaging10DlcRegistration).toHaveBeenCalledWith("user-1", "org-1")
    expect(assignNumberToTelnyx10DlcCampaign).toHaveBeenCalledWith(NEW_NUMBER, "campaign-approved-123")
    expect(result).toMatchObject({
      phone_number: NEW_NUMBER,
      campaign_assigned: true,
      campaign_id: "campaign-approved-123",
    })
  })

  it("leaves the number unassigned (no workspace lookup needed) when the platform campaign already succeeds", async () => {
    process.env.TELNYX_PLATFORM_10DLC_CAMPAIGN_ID = "platform-campaign-1"
    assignNumberToTelnyx10DlcCampaign.mockResolvedValue({ ok: true })

    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", NEW_NUMBER)

    expect(getMessaging10DlcRegistration).not.toHaveBeenCalled()
    expect(result).toMatchObject({ campaign_assigned: true, campaign_id: "platform-campaign-1" })
  })

  it("does not fall back to a workspace campaign for toll-free numbers", async () => {
    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", "+18005551234")

    expect(getMessaging10DlcRegistration).not.toHaveBeenCalled()
    expect(result.skipped_reason).toBe("not_us_local_did")
  })

  it("does not mask a messaging-profile error by attempting the workspace campaign fallback", async () => {
    configureNumberMessaging.mockRejectedValue(new Error("profile boom"))

    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", NEW_NUMBER)

    expect(getMessaging10DlcRegistration).not.toHaveBeenCalled()
    expect(result.error).toBe("Messaging profile: profile boom")
  })

  it("leaves the number unassigned when the workspace has no approved 10DLC registration", async () => {
    getMessaging10DlcRegistration.mockResolvedValue(null)

    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", NEW_NUMBER)

    expect(assignNumberToTelnyx10DlcCampaign).not.toHaveBeenCalled()
    expect(result.campaign_assigned).toBe(false)
    expect(result.skipped_reason).toBe("TELNYX_PLATFORM_10DLC_CAMPAIGN_ID not configured")
  })

  it("leaves the number unassigned when the workspace registration is pending (not yet approved)", async () => {
    getMessaging10DlcRegistration.mockResolvedValue({ status: "pending_review", campaign_id: "campaign-x" })

    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", NEW_NUMBER)

    expect(assignNumberToTelnyx10DlcCampaign).not.toHaveBeenCalled()
    expect(result.campaign_assigned).toBe(false)
  })

  it("surfaces the carrier error when assigning to the workspace campaign fails", async () => {
    getMessaging10DlcRegistration.mockResolvedValue({ status: "approved", campaign_id: "campaign-approved-123" })
    assignNumberToTelnyx10DlcCampaign.mockResolvedValue({ ok: false, error: "carrier rejected it" })

    const result = await provisionLocalDidFor10Dlc("user-1", "org-1", NEW_NUMBER)

    expect(result.campaign_assigned).toBe(false)
    expect(result.error).toBe("Workspace campaign: carrier rejected it")
  })
})
