import { describe, it, expect } from "vitest"
import {
  formatPortingExceptionSystemMessage,
  extractPortingCarrierRequirementLogBody,
} from "@/lib/porting-carrier-exceptions"
import {
  buildPortingWebhookFeedBody,
} from "@/lib/telnyx-porting-webhook-handler"
import { parseZingCustomerReference } from "@/lib/telnyx-customer-reference"
import {
  extractBillingTelephoneNumber,
  isTelnyxPortingWebhookEvent,
} from "@/lib/telnyx-porting-webhook"
import { isValidPortingPin, orderRequiresPinCorrection } from "@/lib/porting-pin-correction"
import type { PortingOrder } from "@/lib/types"

describe("telnyx porting webhook handler", () => {
  it("recognizes porting lifecycle event types", () => {
    expect(isTelnyxPortingWebhookEvent("porting_order.status_changed")).toBe(true)
    expect(isTelnyxPortingWebhookEvent("porting_order.comment_created")).toBe(true)
    expect(isTelnyxPortingWebhookEvent("sub_request.exception")).toBe(true)
    expect(isTelnyxPortingWebhookEvent("message.received")).toBe(false)
  })

  it("extracts billing telephone number from nested payload", () => {
    const body = {
      data: {
        record: {
          end_user: { admin: { billing_phone_number: "+15025571219" } },
          phone_numbers: [{ phone_number: "+15025571219", porting_phone_number_status: "exception" }],
        },
      },
    }
    expect(extractBillingTelephoneNumber(body)).toBe("+15025571219")
  })

  it("formats exception feed line for carrier desk", () => {
    const payload = {
      meta: { event_type: "porting_order.status_changed" },
      data: {
        record: {
          porting_order_status: {
            value: "exception",
            details: [{ code: "PASSCODE_PIN_INVALID", description: "Passcode/pin must be provided for wireless port." }],
          },
        },
      },
    }
    expect(buildPortingWebhookFeedBody(payload, "porting_order.status_changed")).toBe(
      "🔴 Carrier Rejected Correction: Passcode/pin must be provided for wireless port."
    )
    expect(formatPortingExceptionSystemMessage("Passcode/pin must be provided for wireless port.")).toBe(
      "🔴 Carrier Rejected Correction: Passcode/pin must be provided for wireless port."
    )
    expect(extractPortingCarrierRequirementLogBody(payload)).toContain("Losing Carrier")
  })

  it("validates 4–8 digit transfer PINs", () => {
    expect(isValidPortingPin("1234")).toBe(true)
    expect(isValidPortingPin("12345678")).toBe(true)
    expect(isValidPortingPin("123")).toBe(false)
    expect(isValidPortingPin("123456789")).toBe(false)
  })

  it("detects when an order still needs PIN correction", () => {
    const order = {
      status: "action_required",
      telnyx_status: "exception",
      carrier_rejection_reason: "Passcode/pin must be provided for wireless port.",
    } as PortingOrder
    expect(orderRequiresPinCorrection(order)).toBe(true)
  })
})

describe("resolvePortingWebhookOwner", () => {
  it("parses workspace-scoped customer_reference for tenant routing", () => {
    const body = {
      meta: { event_type: "sub_request.exception" },
      data: {
        record: {
          customer_reference: "zing-aaaaaaaa-bbbb-cccc-dddddddddddd--org-key-squad-502",
          id: "po_123",
        },
      },
    }
    const ref = body.data.record.customer_reference
    const parsed = parseZingCustomerReference(ref)
    expect(parsed?.userId).toBe("aaaaaaaa-bbbb-cccc-dddddddddddd")
    expect(parsed?.organizationId).toBe("org-key-squad-502")
  })
})
