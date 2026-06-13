import { describe, it, expect } from "vitest"
import { dedupePortingConversationItems, portingMessageDedupeKey } from "@/lib/porting-conversation-dedupe"
import { buildCarrierLookupBanner } from "@/lib/porting-carrier-lookup-guide"
import { isPortingRenderableMessage, stripPortingJunkLines } from "@/lib/porting-display"
import type { PortingConversationItem, PortingOrder } from "@/lib/types"

const baseOrder: PortingOrder = {
  id: "o1",
  owner_user_id: "u1",
  organization_id: null,
  phone_number: "+15551234567",
  current_carrier: "ONVOY, LLC - KY",
  account_number: "",
  pin_or_sid: null,
  status: "action_required",
  telnyx_order_id: "sr_test",
  telnyx_status: "exception",
  created_at: "2024-06-11T00:00:00Z",
  updated_at: "2024-06-11T00:00:00Z",
}

function item(
  id: string,
  body: string,
  created_at: string,
  author: PortingConversationItem["author"] = "porting_desk"
): PortingConversationItem {
  return {
    id,
    source: "webhook",
    author,
    title: "Carrier update",
    body,
    created_at,
    is_new: false,
  }
}

describe("porting-conversation-dedupe", () => {
  it("collapses invalid PIN duplicates to one newest bubble", () => {
    expect(portingMessageDedupeKey("Rejection due to an invalid PIN/Passcode")).toBe(
      "::invalid-pin-passcode::"
    )
    expect(portingMessageDedupeKey("Invalid passcode on wireless port")).toBe(
      "::invalid-pin-passcode::"
    )

    const deduped = dedupePortingConversationItems([
      item("a", "Rejection due to an invalid PIN/Passcode", "2024-06-11T10:00:00Z", "carrier"),
      item("b", "System Update: Transfer status changed to exception.", "2024-06-11T10:01:00Z", "system"),
      item("c", "Invalid PIN/Passcode provided.", "2024-06-11T11:00:00Z", "porting_desk"),
    ])

    expect(deduped).toHaveLength(2)
    expect(deduped.some((row) => row.id === "c")).toBe(true)
    expect(deduped.some((row) => row.id === "a")).toBe(false)
  })
})

describe("porting junk sanitizer", () => {
  it("blocks lone hyphen separator rows", () => {
    expect(stripPortingJunkLines("Hello\n-\nPIN required")).toBe("Hello\nPIN required")
    expect(isPortingRenderableMessage("-")).toBe(false)
    expect(isPortingRenderableMessage("---")).toBe(false)
  })
})

describe("carrier lookup banner", () => {
  it("returns compact Twilio/Onvoy rule", () => {
    const banner = buildCarrierLookupBanner({
      ...baseOrder,
      current_carrier: "ONVOY, LLC - KY",
    })
    expect(banner?.rule_label).toBe("Carrier Rule for Onvoy")
    expect(banner?.rule_body).toContain("Twilio Account SID")
  })
})
