import { describe, expect, it } from "vitest"
import { shouldAdvancePortingOrderStatus, shouldUpdateTelnyxStatus } from "@/lib/porting-order-sync"
import { extractPortingOrderRecord } from "@/lib/telnyx-porting-webhook"
import { collectPortingStatuses, pickBestPortingStatus, resolveLiveTelnyxPortStatus, labelForPortingStatus } from "@/lib/telnyx-porting-status"
import { mapTelnyxStatusToPortingOrderStatus } from "@/lib/db"

describe("porting-order-sync", () => {
  it("does not downgrade completed to processing", () => {
    expect(shouldAdvancePortingOrderStatus("completed", "processing")).toBe(false)
    expect(shouldAdvancePortingOrderStatus("completed", "completed")).toBe(true)
    expect(shouldAdvancePortingOrderStatus("pending", "processing")).toBe(true)
    expect(shouldAdvancePortingOrderStatus("processing", "rejected")).toBe(true)
  })

  it("extracts status from nested webhook record", () => {
    const body = {
      meta: { event_type: "porting_order.status_changed", id: "evt_1" },
      data: {
        record: {
          id: "po_123",
          customer_reference: "zing-user-1",
          porting_order_status: "in-process",
          phone_numbers: [{ porting_phone_number_status: "foc-date-confirmed" }],
        },
      },
    }
    const record = extractPortingOrderRecord(body)
    expect(record).not.toBeNull()
    const best = pickBestPortingStatus(collectPortingStatuses(record!))
    expect(best).toBe("foc-date-confirmed")
    expect(mapTelnyxStatusToPortingOrderStatus(best)).toBe("processing")
  })

  it("maps ported to completed", () => {
    expect(mapTelnyxStatusToPortingOrderStatus("ported")).toBe("completed")
  })

  it("prefers ported over foc-date-confirmed when both appear on live order", () => {
    const live = {
      porting_order_status: "ported",
      phone_numbers: [{ porting_phone_number_status: "foc-date-confirmed" }],
    }
    const best = pickBestPortingStatus(collectPortingStatuses(live))
    expect(best).toBe("ported")
    expect(mapTelnyxStatusToPortingOrderStatus(best)).toBe("completed")
  })

  it("does not regress telnyx_status from ported to draft", () => {
    expect(shouldUpdateTelnyxStatus("ported", "draft")).toBe(false)
    expect(shouldUpdateTelnyxStatus("in-process", "foc-date-confirmed")).toBe(true)
  })

  it("resolves object porting_order_status without [object Object]", () => {
    const live = {
      porting_order_status: {
        value: "exception",
        details: [{ description: "Passcode/pin must be provided for wireless port." }],
      },
    }
    expect(resolveLiveTelnyxPortStatus(live)).toBe("exception")
    expect(labelForPortingStatus(resolveLiveTelnyxPortStatus(live))).toBe("Rejected or action needed")
  })
})
