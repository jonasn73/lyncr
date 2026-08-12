import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import {
  excludeReadRepliesFromLatest,
  markLatestAttentionOpened,
  markLatestItemSeen,
  markLatestReplySeen,
} from "@/lib/latest-seen"

function replied(
  partial: Partial<LatestCustomerAction> &
    Pick<LatestCustomerAction, "id" | "customerPhone" | "at">
): LatestCustomerAction {
  return {
    customerName: "Customer",
    event: "replied",
    kind: "other",
    headline: "Customer replied",
    statusLine: "Needs reply",
    preview: "Hello",
    deliveryLabel: null,
    reviewLinkOpened: false,
    reviewLinkClicks: 0,
    lastOutbound: null,
    lastInbound: {
      id: "in-1",
      body: "Hello",
      created_at: partial.at,
    },
    completedJobId: null,
    ...partial,
  }
}

function bookForm(
  partial: Partial<LatestCustomerAction> & Pick<LatestCustomerAction, "id" | "at">
): LatestCustomerAction {
  return {
    customerPhone: "+15553330003",
    customerName: "Jonas",
    event: "book_form",
    kind: "booking",
    headline: "Customer submitted book form · ASAP",
    statusLine: "Open intake to book",
    preview: "2020 Honda Civic",
    deliveryLabel: null,
    reviewLinkOpened: false,
    reviewLinkClicks: 0,
    lastOutbound: null,
    lastInbound: null,
    completedJobId: null,
    bookFormLeadId: "lead-1",
    bookFormUrgency: "asap",
    ...partial,
  }
}

function paid(
  partial: Partial<LatestCustomerAction> & Pick<LatestCustomerAction, "id" | "at">
): LatestCustomerAction {
  return {
    customerPhone: "+15554440004",
    customerName: "Sam",
    event: "customer_paid",
    kind: "paid",
    headline: "Sam paid · $120",
    statusLine: "Payment received",
    preview: "Lockout",
    deliveryLabel: null,
    reviewLinkOpened: false,
    reviewLinkClicks: 0,
    lastOutbound: null,
    lastInbound: null,
    completedJobId: "job-pay-1",
    paidAmountCents: 12000,
    ...partial,
  }
}

describe("excludeReadRepliesFromLatest", () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => store.clear(),
    })
    vi.stubGlobal("window", {
      dispatchEvent: () => true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps unread customer replies and job-finished rows", () => {
    const items: LatestCustomerAction[] = [
      replied({
        id: "r1",
        customerPhone: "+15551110001",
        at: "2026-08-01T12:00:00.000Z",
      }),
      {
        id: "job-1",
        customerPhone: "+15552220002",
        customerName: "Jason",
        event: "job_finished",
        kind: "job",
        headline: "Jason · job finished",
        statusLine: "Send thanks + review",
        preview: "Main St",
        at: "2026-08-01T11:00:00.000Z",
        deliveryLabel: null,
        reviewLinkOpened: false,
        reviewLinkClicks: 0,
        lastOutbound: null,
        lastInbound: null,
        completedJobId: "job-1",
      },
    ]
    expect(excludeReadRepliesFromLatest(items)).toHaveLength(2)
  })

  it("drops a customer reply after the owner marks it seen", () => {
    const phone = "+15551110001"
    const at = "2026-08-01T12:00:00.000Z"
    const items = [replied({ id: "r1", customerPhone: phone, at })]
    markLatestReplySeen(phone, "2026-08-01T13:00:00.000Z")
    expect(excludeReadRepliesFromLatest(items)).toHaveLength(0)
  })

  it("brings a reply back when a newer inbound arrives", () => {
    const phone = "+15551110001"
    markLatestReplySeen(phone, "2026-08-01T12:00:00.000Z")
    const items = [
      replied({
        id: "r2",
        customerPhone: phone,
        at: "2026-08-01T14:00:00.000Z",
        lastInbound: {
          id: "in-2",
          body: "Still here?",
          created_at: "2026-08-01T14:00:00.000Z",
        },
      }),
    ]
    expect(excludeReadRepliesFromLatest(items)).toHaveLength(1)
  })

  it("drops book_form after open even if the same id returns from the API", () => {
    const item = bookForm({ id: "book-lead-1", at: "2026-08-01T15:00:00.000Z" })
    markLatestAttentionOpened(item)
    expect(excludeReadRepliesFromLatest([item])).toHaveLength(0)
  })

  it("drops customer_paid after View / detail open", () => {
    const item = paid({ id: "wallet-tx-9", at: "2026-08-01T16:00:00.000Z" })
    markLatestItemSeen(item.id)
    expect(excludeReadRepliesFromLatest([item])).toHaveLength(0)
  })

  it("keeps paid+thanks-pending after open until Send thanks", () => {
    const item = paid({
      id: "wallet-tx-thanks",
      at: "2026-08-01T16:00:00.000Z",
      thanksReviewPending: true,
      statusLine: "Payment received · Send thanks",
    })
    markLatestAttentionOpened(item)
    expect(excludeReadRepliesFromLatest([item])).toHaveLength(1)
  })

  it("keeps job_finished after markLatestAttentionOpened (Send still required)", () => {
    const job: LatestCustomerAction = {
      id: "job-2",
      customerPhone: "+15552220002",
      customerName: "Jason",
      event: "job_finished",
      kind: "job",
      headline: "Jason · job finished",
      statusLine: "Send thanks + review",
      preview: "Main St",
      at: "2026-08-01T11:00:00.000Z",
      deliveryLabel: null,
      reviewLinkOpened: false,
      reviewLinkClicks: 0,
      lastOutbound: null,
      lastInbound: null,
      completedJobId: "job-2",
    }
    markLatestAttentionOpened(job)
    expect(excludeReadRepliesFromLatest([job])).toHaveLength(1)
  })
})
