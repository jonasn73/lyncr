import { afterEach, describe, expect, it, vi } from "vitest"
import { defaultCampaignCopy } from "@/lib/messaging-10dlc"
import {
  assignNumberToTelnyx10DlcCampaign,
  buildTenDlcHelpMessage,
  buildTenDlcOptinMessage,
  effectiveTelnyx10DlcCampaignId,
  formatTelnyxRegistryText,
  isTelnyxRegistryRejected,
  LOW_VOLUME_SUB_USECASES,
  normalizeTelnyxRegistryStatus,
} from "@/lib/telnyx-10dlc"

describe("formatTelnyxRegistryText", () => {
  it("returns null for [object Object] strings", () => {
    expect(formatTelnyxRegistryText("[object Object]")).toBeNull()
  })

  it("extracts nested failure reason objects", () => {
    expect(formatTelnyxRegistryText({ description: "Sample messages missing STOP language." })).toBe(
      "Sample messages missing STOP language."
    )
  })

  it("joins array failure reasons", () => {
    expect(formatTelnyxRegistryText(["Invalid sample", "Missing opt-in flow"])).toBe(
      "Invalid sample; Missing opt-in flow"
    )
  })
})

describe("normalizeTelnyxRegistryStatus", () => {
  it("treats TCR_FAILED as rejected", () => {
    expect(normalizeTelnyxRegistryStatus("TCR_FAILED")).toBe("rejected")
  })

  it("treats MNO_PROVISIONED as approved", () => {
    expect(normalizeTelnyxRegistryStatus("MNO_PROVISIONED")).toBe("approved")
  })

  it("treats TCR_PENDING as pending review", () => {
    expect(normalizeTelnyxRegistryStatus("TCR_PENDING")).toBe("pending_review")
  })

  it("treats TELNYX_FAILED as rejected", () => {
    expect(normalizeTelnyxRegistryStatus("TELNYX_FAILED")).toBe("rejected")
  })
})

describe("isTelnyxRegistryRejected", () => {
  it("detects TCR_FAILED", () => {
    expect(isTelnyxRegistryRejected("TCR_FAILED")).toBe(true)
  })

  it("ignores pending statuses", () => {
    expect(isTelnyxRegistryRejected("TCR_PENDING")).toBe(false)
  })
})

describe("LOW_VOLUME_SUB_USECASES", () => {
  it("includes account notifications for transactional lead alerts", () => {
    expect(LOW_VOLUME_SUB_USECASES).toContain("ACCOUNT_NOTIFICATION")
    expect(LOW_VOLUME_SUB_USECASES.length).toBeGreaterThanOrEqual(1)
  })
})

describe("effectiveTelnyx10DlcCampaignId", () => {
  it("returns null when campaign id equals brand id", () => {
    const id = "4b30019f-1bf7-b266-793c-2acecbd29e6b"
    expect(
      effectiveTelnyx10DlcCampaignId({
        brand_id: id,
        campaign_id: id,
      })
    ).toBeNull()
  })

  it("returns campaign id when distinct from brand id", () => {
    expect(
      effectiveTelnyx10DlcCampaignId({
        brand_id: "brand-1",
        campaign_id: "campaign-2",
      })
    ).toBe("campaign-2")
  })
})

describe("10DLC compliant opt-in copy", () => {
  it("includes Message frequency may vary in the START confirmation", () => {
    expect(buildTenDlcOptinMessage("Key Squad")).toMatch(/Message frequency may vary/i)
    expect(buildTenDlcOptinMessage("Key Squad")).toMatch(/Consent is not a condition of purchase/i)
  })

  it("includes a real support contact in the HELP reply", () => {
    const help = buildTenDlcHelpMessage("Key Squad")
    expect(help).toMatch(/lyncr\.app\/support/)
    expect(help.toLowerCase()).toMatch(/@/)
    const branded = buildTenDlcHelpMessage("Key Squad", {
      website: "https://keysquad502.com",
      email: "hello@keysquad502.com",
    })
    expect(branded).toMatch(/keysquad502\.com/)
    expect(branded).toMatch(/hello@keysquad502\.com/)
  })

  it("documents the public sms-opt-in form and consent checkbox language", () => {
    const copy = defaultCampaignCopy("Key Squad", { website: "https://keysquad502.com" })
    expect(copy.messageFlow).toMatch(/sms-opt-in/)
    expect(copy.messageFlow).toMatch(/brand=Key\+Squad|brand=Key%20Squad/)
    expect(copy.messageFlow).toMatch(/keysquad502\.com/)
    expect(copy.messageFlow.toLowerCase()).toMatch(/checkbox|consent/)
    expect(copy.messageFlow).toMatch(/Message frequency may vary/)
    expect(copy.sample1).toMatch(/Message frequency may vary/)
    expect(copy.sample2).toMatch(/HELP/)
  })
})

describe("assignNumberToTelnyx10DlcCampaign", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("treats 'already assigned to this campaign' as success, not a failure needing a retry", async () => {
    vi.stubEnv("TELNYX_API_KEY", "test-key")
    const campaignId = "4b30019f-690e-8e9b-5e67-c26f7f5af9d8"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            errors: [{ detail: `+15025571219 is already assigned to campaign ${campaignId}` }],
          }),
      })
    )
    const result = await assignNumberToTelnyx10DlcCampaign("+15025571219", campaignId)
    expect(result).toEqual({ ok: true })
  })

  it("still reports a real assignment failure for a different campaign", async () => {
    vi.stubEnv("TELNYX_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            errors: [{ detail: "+15025571219 is already assigned to campaign some-other-campaign" }],
          }),
      })
    )
    const result = await assignNumberToTelnyx10DlcCampaign("+15025571219", "the-campaign-we-want")
    expect(result.ok).toBe(false)
  })

  it("still reports an unrelated Telnyx error as a real failure", async () => {
    vi.stubEnv("TELNYX_API_KEY", "test-key")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ errors: [{ detail: "Number not found." }] }),
      })
    )
    const result = await assignNumberToTelnyx10DlcCampaign("+15025571219", "campaign-1")
    expect(result.ok).toBe(false)
  })
})
