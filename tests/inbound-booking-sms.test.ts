import { afterEach, describe, expect, it, vi } from "vitest"

const { sendAndLogWorkspaceCustomerSmsMock, getActivePhoneNumberByE164Mock } = vi.hoisted(() => ({
  sendAndLogWorkspaceCustomerSmsMock: vi.fn(),
  getActivePhoneNumberByE164Mock: vi.fn(),
}))

vi.mock("@/lib/workspace-customer-sms", () => ({
  sendAndLogWorkspaceCustomerSms: sendAndLogWorkspaceCustomerSmsMock,
}))

vi.mock("@/lib/db", () => ({
  getActivePhoneNumberByE164: getActivePhoneNumberByE164Mock,
  updateCallLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/booking-invite", () => ({
  buildBookQueryUrl: vi.fn(() => "https://lyncr.app/book?x=1"),
  createBookingInvite: vi.fn().mockResolvedValue({ url: "https://lyncr.app/b/abc" }),
}))

vi.mock("@/lib/telnyx-menu", () => ({
  buildTelnyxMenuBookingSms: vi.fn(() => "Text: book now https://lyncr.app/b/abc"),
}))

vi.mock("@/lib/telnyx-sms", () => ({
  sendTelnyxSms: vi.fn(),
}))

vi.mock("@/lib/hold-queue", () => ({
  callerGreetingPrefix: vi.fn(() => ""),
}))

vi.mock("@/lib/booking-sms-guards", () => ({
  claimIvrAction: vi.fn().mockResolvedValue(true),
  hasOutboundSmsToCustomerRecently: vi.fn().mockResolvedValue(false),
}))

import { sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"

describe("sendInboundBookingSmsAndTag — multi-shop owners", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("resolves organizationId from the called business line so a multi-shop owner's SMS doesn't get blocked", async () => {
    getActivePhoneNumberByE164Mock.mockResolvedValue({
      id: "line-1",
      organization_id: "org-key-squad",
    })
    sendAndLogWorkspaceCustomerSmsMock.mockResolvedValue({ ok: true, message: null, from: "+15025571219", to: "+15551234567", message_id: "m1", delivery_warning: null })

    const result = await sendInboundBookingSmsAndTag({
      fromE164: "+15551234567",
      ownerUserId: "owner-1",
      businessLineE164: "+15025571219",
      callSid: "call-1",
      routedToName: "Booked from hold · press 1",
      source: "cc_busy_press1",
    })

    expect(getActivePhoneNumberByE164Mock).toHaveBeenCalledWith("+15025571219")
    expect(sendAndLogWorkspaceCustomerSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-key-squad" })
    )
    expect(result.outcome).toBe("sent")
  })

  it("never claims to have sent when the multi-shop guard rejects the send", async () => {
    getActivePhoneNumberByE164Mock.mockResolvedValue(null)
    sendAndLogWorkspaceCustomerSmsMock.mockResolvedValue({
      ok: false,
      error:
        "SMS blocked: this account has more than one shop, and no shop was specified.",
    })

    const result = await sendInboundBookingSmsAndTag({
      fromE164: "+15551234567",
      ownerUserId: "owner-1",
      businessLineE164: "+15025571219",
      callSid: "call-2",
      routedToName: "Booked from hold · press 1",
      source: "cc_busy_press1",
    })

    expect(result.outcome).toBe("failed")
  })

  it("passes null organizationId for a legacy org id rather than blocking on a bad value", async () => {
    getActivePhoneNumberByE164Mock.mockResolvedValue({
      id: "line-1",
      organization_id: "legacy-owner-1",
    })
    sendAndLogWorkspaceCustomerSmsMock.mockResolvedValue({ ok: true, message: null, from: "+15025571219", to: "+15551234567", message_id: "m1", delivery_warning: null })

    await sendInboundBookingSmsAndTag({
      fromE164: "+15551234567",
      ownerUserId: "owner-1",
      businessLineE164: "+15025571219",
      callSid: "call-3",
      routedToName: "Booked from hold · press 1",
      source: "cc_busy_press1",
    })

    expect(sendAndLogWorkspaceCustomerSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null })
    )
  })
})
