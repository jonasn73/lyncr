import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LatestCustomerAction } from "@/lib/latest-customer-actions"
import {
  excludeReadRepliesFromLatest,
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
})
