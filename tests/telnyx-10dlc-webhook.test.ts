import { describe, expect, it } from "vitest"
import {
  formatTelnyx10DlcFailureReasons,
  isTelnyx10DlcWebhookEvent,
  parseTelnyx10DlcWebhook,
  resolveTenDlcWebhookOutcome,
} from "@/lib/telnyx-10dlc-webhook"
import {
  buildTenDlcNotificationCopy,
  TEN_DLC_APPROVED_MESSAGE,
  tenDlcRejectedMessage,
} from "@/services/notificationService"

describe("isTelnyx10DlcWebhookEvent", () => {
  it("accepts modern 10dlc.* events", () => {
    expect(isTelnyx10DlcWebhookEvent("10dlc.brand.update")).toBe(true)
    expect(isTelnyx10DlcWebhookEvent("10dlc.campaign.update")).toBe(true)
  })

  it("accepts brand.* lifecycle names from Telnyx brand docs", () => {
    expect(isTelnyx10DlcWebhookEvent("brand.vetted")).toBe(true)
    expect(isTelnyx10DlcWebhookEvent("brand.created")).toBe(true)
    expect(isTelnyx10DlcWebhookEvent("brand.updated")).toBe(true)
  })

  it("rejects porting events", () => {
    expect(isTelnyx10DlcWebhookEvent("porting_order.status_changed")).toBe(false)
  })
})

describe("formatTelnyx10DlcFailureReasons", () => {
  it("formats REGISTRATION reasons with field + description", () => {
    expect(
      formatTelnyx10DlcFailureReasons([
        { fields: ["ein"], description: "Invalid EIN - EIN is a nine-digit number." },
      ])
    ).toBe("ein: Invalid EIN - EIN is a nine-digit number.")
  })
})

describe("resolveTenDlcWebhookOutcome", () => {
  it("approves VERIFIED / VETTED_VERIFIED identityStatus", () => {
    const vetted = parseTelnyx10DlcWebhook({
      data: {
        event_type: "brand.vetted",
        payload: {
          brandId: "brand-1",
          identityStatus: "VETTED_VERIFIED",
        },
      },
    })
    expect(resolveTenDlcWebhookOutcome(vetted).outcome).toBe("approved")

    const verified = parseTelnyx10DlcWebhook({
      data: {
        event_type: "10dlc.brand.update",
        payload: { brandId: "brand-1", identityStatus: "VERIFIED" },
      },
    })
    expect(resolveTenDlcWebhookOutcome(verified).outcome).toBe("approved")
  })

  it("rejects UNVERIFIED with failure reason", () => {
    const parsed = parseTelnyx10DlcWebhook({
      data: {
        event_type: "brand.vetted",
        payload: {
          brandId: "brand-1",
          identityStatus: "UNVERIFIED",
          failureReasons: "EIN Mismatch",
        },
      },
    })
    const resolved = resolveTenDlcWebhookOutcome(parsed)
    expect(resolved.outcome).toBe("rejected")
    expect(resolved.failureReason).toContain("EIN Mismatch")
  })

  it("approves campaign VERIFIED / ACTIVE", () => {
    const verified = parseTelnyx10DlcWebhook({
      data: {
        event_type: "10dlc.campaign.update",
        payload: {
          brandId: "b1",
          campaignId: "c1",
          type: "VERIFIED",
        },
      },
    })
    expect(resolveTenDlcWebhookOutcome(verified).outcome).toBe("approved")

    const active = parseTelnyx10DlcWebhook({
      data: {
        event_type: "10dlc.campaign.update",
        payload: {
          campaignId: "c1",
          status: "ACTIVE",
          type: "TCR_EVENT",
          eventType: "CAMPAIGN_UPDATE",
        },
      },
    })
    expect(resolveTenDlcWebhookOutcome(active).outcome).toBe("approved")
  })

  it("rejects campaign REGISTRATION failures", () => {
    const parsed = parseTelnyx10DlcWebhook({
      data: {
        event_type: "10dlc.campaign.update",
        payload: {
          campaignId: "c1",
          status: "failed",
          type: "REGISTRATION",
          reasons: [{ fields: ["sample1"], description: "Missing STOP language" }],
        },
      },
    })
    const resolved = resolveTenDlcWebhookOutcome(parsed)
    expect(resolved.outcome).toBe("rejected")
    expect(resolved.failureReason).toContain("Missing STOP language")
  })
})

describe("notificationService copy", () => {
  it("uses the approved success message", () => {
    const copy = buildTenDlcNotificationCopy("approved")
    expect(copy.message).toBe(TEN_DLC_APPROVED_MESSAGE)
  })

  it("embeds the failure reason in rejection copy", () => {
    expect(tenDlcRejectedMessage("EIN Mismatch")).toContain("EIN Mismatch")
    expect(tenDlcRejectedMessage("Invalid Address")).toContain("re-submit")
  })
})
