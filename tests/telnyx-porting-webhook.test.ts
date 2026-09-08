import { describe, it, expect } from "vitest"
import {
  customerRefToUserId,
  findLyncrCustomerReference,
  extractEventType,
  extractTelnyxEventId,
  extractPortingOrderRecord,
} from "@/lib/telnyx-porting-webhook"
import {
  collectPortingStatuses,
  pickBestPortingStatus,
  normalizeTelnyxPortStatus,
} from "@/lib/telnyx-porting-status"

describe("telnyx-porting-webhook", () => {
  it("finds zing customer_reference in nested payload", () => {
    const ref = findLyncrCustomerReference({
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

  it("extracts porting order from Telnyx v2 data.payload webhooks", () => {
    const body = {
      data: {
        event_type: "porting_order.status_changed",
        payload: {
          id: "3594c6c3-51a7-4306-b715-ca3765f13464",
          customer_reference: "zing-aaaaaaaa-bbbb-cccc-dddddddddddd",
          status: { value: "ported", details: [] },
          support_key: "sr_a11eda",
        },
      },
    }
    const record = extractPortingOrderRecord(body)
    expect(record?.support_key).toBe("sr_a11eda")
    expect(pickBestPortingStatus(collectPortingStatuses(record!))).toBe("ported")
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

  it("reads ported from Telnyx v2 status object on GET /porting_orders", () => {
    const live = {
      id: "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e",
      status: { value: "ported", details: [] },
      phone_numbers: [{ porting_phone_number_status: "foc-date-confirmed" }],
    }
    const best = pickBestPortingStatus(collectPortingStatuses(live))
    expect(best).toBe("ported")
  })
})
