import { describe, it, expect } from "vitest"
import {
  customerRefToUserId,
  findZingCustomerReference,
  extractEventType,
  extractTelnyxEventId,
} from "@/lib/telnyx-porting-webhook"
import {
  collectPortingStatuses,
  pickBestPortingStatus,
  normalizeTelnyxPortStatus,
} from "@/lib/telnyx-porting-status"

describe("telnyx-porting-webhook", () => {
  it("finds zing customer_reference in nested payload", () => {
    const ref = findZingCustomerReference({
      data: {
        record: {
          customer_reference: "zing-aaaaaaaa-bbbb-cccc-dddddddddddd",
        },
      },
    })
    expect(ref).toBe("zing-aaaaaaaa-bbbb-cccc-dddddddddddd")
    expect(customerRefToUserId(ref!)).toBe("aaaaaaaa-bbbb-cccc-dddddddddddd")
  })

  it("extracts event type and id", () => {
    const body = {
      meta: { event_type: "porting_order.status_changed", id: "evt_test_1" },
      data: { customer_reference: "zing-u1" },
    }
    expect(extractEventType(body)).toBe("porting_order.status_changed")
    expect(extractTelnyxEventId(body)).toBe("evt_test_1")
  })
})

describe("telnyx-porting-status", () => {
  it("prefers nested exception over order draft", () => {
    const order = {
      porting_order_status: "draft",
      phone_numbers: [{ phone_number: "+15025571219", porting_phone_number_status: "exception" }],
    }
    const best = pickBestPortingStatus(collectPortingStatuses(order))
    expect(best).toBe("exception")
  })

  it("normalizes US spelling canceled → cancelled", () => {
    expect(normalizeTelnyxPortStatus("Canceled")).toBe("cancelled")
  })
})
