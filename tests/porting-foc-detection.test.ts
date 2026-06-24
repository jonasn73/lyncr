import { describe, expect, it } from "vitest"
import {
  carrierTextIndicatesFocConfirmed,
  orderHasFocScheduled,
} from "@/lib/porting-foc-detection"
import { buildOwnerPortingPipeline, getPortingBannerPhase } from "@/lib/porting-lifecycle"
import type { PortingOrder } from "@/lib/types"

const baseOrder: PortingOrder = {
  id: "po-1",
  owner_user_id: "user-1",
  organization_id: "org-1",
  phone_number: "+15025571219",
  current_carrier: "AT&T",
  account_number: "123",
  pin_or_sid: null,
  status: "action_required",
  telnyx_order_id: "telnyx-1",
  telnyx_status: "exception",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-24T00:00:00Z",
}

const focMessage = `Hey team,
The losing carrier has confirmed FOC.
FOC Date: 06/25/2026
FOC Time: 9:00 AM`

describe("porting-foc-detection", () => {
  it("detects FOC confirmation in carrier network messages", () => {
    expect(carrierTextIndicatesFocConfirmed(focMessage)).toBe(true)
    expect(carrierTextIndicatesFocConfirmed("This is an automated order.")).toBe(false)
    expect(carrierTextIndicatesFocConfirmed("FOC rejected by losing carrier")).toBe(false)
  })

  it("advances pipeline to FOC Date Scheduled when carrier text confirms FOC", () => {
    expect(orderHasFocScheduled(baseOrder, [focMessage])).toBe(true)
    const steps = buildOwnerPortingPipeline(baseOrder, { carrierTexts: [focMessage] })
    expect(steps.find((s) => s.key === "foc_scheduled")?.state).toBe("current")
    expect(steps.find((s) => s.key === "action_verifying")?.state).toBe("complete")
  })

  it("treats FOC-scheduled orders as in progress for banners", () => {
    expect(getPortingBannerPhase(baseOrder, 2, { carrierTexts: [focMessage] })).toBe("in_progress")
  })
})
