import { describe, expect, it } from "vitest"
import { defaultCampaignCopy } from "@/lib/messaging-10dlc"
import {
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
