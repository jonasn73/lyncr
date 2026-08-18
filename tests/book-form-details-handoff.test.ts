import { describe, expect, it } from "vitest"
import { findLatestBookFormForPhone } from "@/lib/book-form-details-handoff"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"

function bookRow(
  phone: string,
  at: string,
  name = "Isaac"
): LatestCustomerAction {
  return {
    id: `book-${phone}-${at}`,
    customerPhone: phone,
    customerName: name,
    event: "book_form",
    kind: "booking",
    headline: `${name} submitted a booking`,
    statusLine: "ASAP",
    preview: "Keys lost",
    at,
    deliveryLabel: null,
    reviewLinkOpened: false,
    reviewLinkClicks: 0,
    lastOutbound: null,
    lastInbound: null,
    completedJobId: null,
  }
}

describe("findLatestBookFormForPhone", () => {
  it("picks the newest book form for this phone", () => {
    const older = bookRow("+15028762058", "2026-08-17T12:00:00.000Z")
    const newer = bookRow("(502) 876-2058", "2026-08-18T16:00:00.000Z")
    const other = bookRow("+15025550112", "2026-08-18T18:00:00.000Z", "Riley")
    expect(findLatestBookFormForPhone([older, other, newer], "+1 (502) 876-2058")?.id).toBe(
      newer.id
    )
  })

  it("returns null when this phone has no leftover booking", () => {
    expect(findLatestBookFormForPhone([bookRow("+15025550112", "2026-08-18T18:00:00.000Z")], "+15028762058")).toBeNull()
  })
})
