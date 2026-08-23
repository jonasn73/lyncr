import { describe, expect, it } from "vitest"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import { sanitizeLatestItems } from "@/lib/owner-latest-cache"

function replied(at: string, id = "r1"): LatestCustomerAction {
  return {
    id,
    customerPhone: "+15551110001",
    customerName: "Pat",
    event: "replied",
    kind: "other",
    headline: "Pat replied",
    statusLine: "Needs reply",
    preview: "Hello",
    at,
    completedJobId: null,
    deliveryLabel: null,
    reviewLinkOpened: false,
    reviewLinkClicks: 0,
    lastOutbound: null,
    lastInbound: {
      id: "in-1",
      body: "Hello",
      created_at: at,
    },
  }
}

describe("sanitizeLatestItems", () => {
  const now = Date.parse("2026-08-16T20:00:00.000Z")

  it("drops age-stale unreplied rows from paint/session seeds", () => {
    const items = sanitizeLatestItems(
      [replied("2026-08-14T12:00:00.000Z", "old"), replied("2026-08-16T12:00:00.000Z", "new")],
      null,
      now
    )
    expect(items.map((r) => r.id)).toEqual(["new"])
  })

  it("drops Cleared row ids using the seen paint snapshot (SSR-safe)", () => {
    const book: LatestCustomerAction = {
      id: "book-1",
      customerPhone: "+15552220002",
      customerName: "Chris",
      event: "book_form",
      kind: "booking",
      headline: "Booked",
      statusLine: "Lockout",
      preview: "Main St",
      at: "2026-08-16T12:00:00.000Z",
      completedJobId: null,
      deliveryLabel: null,
      reviewLinkOpened: false,
      reviewLinkClicks: 0,
      lastOutbound: null,
      lastInbound: null,
    }
    const items = sanitizeLatestItems([book], {
      replies: {},
      items: { "book-1": "2026-08-16T13:00:00.000Z" },
    }, now)
    expect(items).toEqual([])
  })
})
