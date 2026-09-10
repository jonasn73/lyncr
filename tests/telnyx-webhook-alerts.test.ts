import { describe, expect, it, vi, beforeEach } from "vitest"

const recordWebhookSignatureFailure = vi.fn()
const markWebhookSignatureAlertSent = vi.fn()
const listPlatformAdminContacts = vi.fn()
const deliverPlatformHealthAlert = vi.fn()

vi.mock("@/lib/db", () => ({
  recordWebhookSignatureFailure: (...args: unknown[]) => recordWebhookSignatureFailure(...args),
  markWebhookSignatureAlertSent: (...args: unknown[]) => markWebhookSignatureAlertSent(...args),
  listPlatformAdminContacts: (...args: unknown[]) => listPlatformAdminContacts(...args),
}))
vi.mock("@/lib/platform-health-notify", () => ({
  deliverPlatformHealthAlert: (...args: unknown[]) => deliverPlatformHealthAlert(...args),
}))

import { alertOnInvalidTelnyxSignature } from "@/lib/telnyx-webhook-alerts"

describe("alertOnInvalidTelnyxSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deliverPlatformHealthAlert.mockResolvedValue({ channel: "sms" })
  })

  it("does nothing when the cooldown says not to alert yet", async () => {
    recordWebhookSignatureFailure.mockResolvedValue({ shouldAlert: false, eventCount: 3, firstEventAt: null })
    await alertOnInvalidTelnyxSignature("webhooks/telnyx/voice", true)
    expect(listPlatformAdminContacts).not.toHaveBeenCalled()
    expect(deliverPlatformHealthAlert).not.toHaveBeenCalled()
    expect(markWebhookSignatureAlertSent).not.toHaveBeenCalled()
  })

  it("pages every platform admin and marks the alert sent when the cooldown clears", async () => {
    recordWebhookSignatureFailure.mockResolvedValue({
      shouldAlert: true,
      eventCount: 4,
      firstEventAt: new Date().toISOString(),
    })
    listPlatformAdminContacts.mockResolvedValue([
      { id: "u1", email: "a@lyncr.app", phone: "", is_platform_admin: true, name: "A" },
      { id: "u2", email: "b@lyncr.app", phone: "", is_platform_admin: true, name: "B" },
    ])

    await alertOnInvalidTelnyxSignature("webhooks/telnyx/voice", true)

    expect(deliverPlatformHealthAlert).toHaveBeenCalledTimes(2)
    const text = deliverPlatformHealthAlert.mock.calls[0][0].text as string
    expect(text).toContain("webhooks/telnyx/voice")
    expect(text).toContain("4x")
    expect(text).toContain("REJECTED")
    expect(markWebhookSignatureAlertSent).toHaveBeenCalledWith("telnyx-webhook-signature:webhooks/telnyx/voice")
  })

  it("uses warn-only language when not yet enforced", async () => {
    recordWebhookSignatureFailure.mockResolvedValue({ shouldAlert: true, eventCount: 1, firstEventAt: null })
    listPlatformAdminContacts.mockResolvedValue([
      { id: "u1", email: "a@lyncr.app", phone: "", is_platform_admin: true, name: "A" },
    ])

    await alertOnInvalidTelnyxSignature("webhooks/telnyx/messaging", false)

    const text = deliverPlatformHealthAlert.mock.calls[0][0].text as string
    expect(text).not.toContain("REJECTED")
    expect(text).toContain("still warn-only")
  })

  it("skips paging when there are no platform admins", async () => {
    recordWebhookSignatureFailure.mockResolvedValue({ shouldAlert: true, eventCount: 1, firstEventAt: null })
    listPlatformAdminContacts.mockResolvedValue([])

    await alertOnInvalidTelnyxSignature("webhooks/telnyx/voice", true)

    expect(deliverPlatformHealthAlert).not.toHaveBeenCalled()
    expect(markWebhookSignatureAlertSent).not.toHaveBeenCalled()
  })

  it("never throws, even when the DB call fails", async () => {
    recordWebhookSignatureFailure.mockRejectedValue(new Error("db down"))
    await expect(alertOnInvalidTelnyxSignature("webhooks/telnyx/voice", true)).resolves.toBeUndefined()
  })

  it("never throws, even when alert delivery fails", async () => {
    recordWebhookSignatureFailure.mockResolvedValue({ shouldAlert: true, eventCount: 1, firstEventAt: null })
    listPlatformAdminContacts.mockResolvedValue([
      { id: "u1", email: "a@lyncr.app", phone: "", is_platform_admin: true, name: "A" },
    ])
    deliverPlatformHealthAlert.mockRejectedValue(new Error("send failed"))
    await expect(alertOnInvalidTelnyxSignature("webhooks/telnyx/voice", true)).resolves.toBeUndefined()
  })
})
