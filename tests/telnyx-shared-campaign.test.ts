import { describe, it, expect } from "vitest"
import {
  buildZingCustomerReference,
  parseZingCustomerReference,
} from "@/lib/telnyx-customer-reference"
import { isUsLocalDid, getPlatform10DlcCampaignId } from "@/lib/telnyx-shared-campaign"
import {
  PORTING_PIN_EIGHT_DIGIT_PATTERN,
  PORTING_PIN_FLEX_PATTERN,
  requiresExactEightDigitWirelessPin,
  validatePortingDeskPin,
  validatePortingDeskSubmission,
  storedPortingPinForDesk,
} from "@/lib/porting-desk-validation"
import type { PortingOrder } from "@/lib/types"

describe("telnyx-customer-reference", () => {
  it("encodes and parses workspace-scoped customer_reference", () => {
    const ref = buildZingCustomerReference("user-1", "org-key-squad")
    expect(ref).toBe("zing-user-1--org-key-squad")
    expect(parseZingCustomerReference(ref)).toEqual({
      userId: "user-1",
      organizationId: "org-key-squad",
    })
  })

  it("parses legacy owner-only reference", () => {
    expect(parseZingCustomerReference("zing-aaaaaaaa-bbbb-cccc-dddddddddddd")).toEqual({
      userId: "aaaaaaaa-bbbb-cccc-dddddddddddd",
      organizationId: null,
    })
  })
})

describe("telnyx-shared-campaign", () => {
  it("detects US local DIDs vs toll-free", () => {
    expect(isUsLocalDid("+15025571219")).toBe(true)
    expect(isUsLocalDid("+18005551212")).toBe(false)
  })
})

describe("porting-desk-validation", () => {
  const baseOrder = {
    current_carrier: "Verizon Wireless",
    carrier_rejection_reason: "Passcode/pin must be provided for wireless port.",
    status: "action_required",
  } as PortingOrder

  it("accepts 4–8 digit PIN by default", () => {
    expect(PORTING_PIN_FLEX_PATTERN.test("1234")).toBe(true)
    expect(validatePortingDeskPin("12345678", baseOrder).ok).toBe(true)
  })

  it("requires exactly 8 digits when carrier message says so", () => {
    const order = {
      ...baseOrder,
      carrier_rejection_reason: "Wireless port requires exactly 8 digit PIN.",
    } as PortingOrder
    expect(requiresExactEightDigitWirelessPin(order)).toBe(true)
    expect(validatePortingDeskPin("1234567", order).ok).toBe(false)
    expect(validatePortingDeskPin("12345678", order).ok).toBe(true)
    expect(PORTING_PIN_EIGHT_DIGIT_PATTERN.test("12345678")).toBe(true)
  })

  it("blocks empty PIN submission when correction required", () => {
    const result = validatePortingDeskSubmission({
      order: baseOrder,
      pinRequired: true,
      pin: "",
      message: "",
    })
    expect(result.ok).toBe(false)
  })

  it("does not treat Twilio SID / hash as a stored PIN for desk prefill", () => {
    const order = { pin_or_sid: "64d4f49a0932d68b4c9d4b54c288e178" } as PortingOrder
    expect(storedPortingPinForDesk(order)).toBe("")
    const withPin = { pin_or_sid: "1234" } as PortingOrder
    expect(storedPortingPinForDesk(withPin)).toBe("1234")
  })
})

describe("platform campaign env", () => {
  it("reads TELNYX_PLATFORM_10DLC_CAMPAIGN_ID when set", () => {
    const prev = process.env.TELNYX_PLATFORM_10DLC_CAMPAIGN_ID
    process.env.TELNYX_PLATFORM_10DLC_CAMPAIGN_ID = "camp_test_123"
    expect(getPlatform10DlcCampaignId()).toBe("camp_test_123")
    process.env.TELNYX_PLATFORM_10DLC_CAMPAIGN_ID = prev
  })
})
