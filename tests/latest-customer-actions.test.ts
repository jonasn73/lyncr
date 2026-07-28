import { describe, expect, it } from "vitest"
import {
  buildLatestCustomerActions,
  classifyOutboundSmsKind,
  isHotLatestAction,
} from "@/lib/latest-customer-actions"
import type { SmsMessage } from "@/lib/types"

function sms(partial: Partial<SmsMessage> & Pick<SmsMessage, "id" | "direction" | "body" | "created_at">): SmsMessage {
  return {
    organization_id: null,
    owner_user_id: "owner",
    phone_number_id: null,
    from_number: partial.direction === "inbound" ? "+15551110001" : "+15559990000",
    to_number: partial.direction === "inbound" ? "+15559990000" : "+15551110001",
    customer_phone: "+15551110001",
    telnyx_message_id: "tx-1",
    status: partial.direction === "inbound" ? "received" : "delivered",
    ...partial,
  }
}

const NOW = Date.parse("2026-07-27T20:00:00.000Z")

describe("classifyOutboundSmsKind", () => {
  it("detects review links", () => {
    expect(classifyOutboundSmsKind("Thanks! Leave a review https://lyncr.app/rv/abc")).toBe("review")
  })
})

describe("buildLatestCustomerActions", () => {
  it("hides outbound-only threads (no Jessica-style review sent card)", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [
        sms({
          id: "o1",
          direction: "outbound",
          body: "Thanks! https://lyncr.app/rv/x",
          created_at: "2026-07-25T12:00:00.000Z",
          customer_phone: "+15552220002",
        }),
      ],
      nameHints: [{ phone: "+15552220002", name: "Jessica" }],
      completedJobs: [
        {
          id: "job-jess",
          customerPhone: "+15552220002",
          customerName: "Jessica",
          location: "Main St",
          summary: "Done",
          at: "2026-07-25T11:00:00.000Z",
          reviewSmsSentAt: "2026-07-25T12:00:00.000Z",
        },
      ],
      limit: 6,
    })
    expect(latest).toEqual([])
  })

  it("surfaces unreplied inbound as Needs reply", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [
        sms({
          id: "o1",
          direction: "outbound",
          body: "On the way",
          created_at: "2026-07-27T15:00:00.000Z",
          customer_phone: "+15553330003",
        }),
        sms({
          id: "i1",
          direction: "inbound",
          body: "How long?",
          created_at: "2026-07-27T16:00:00.000Z",
          customer_phone: "+15553330003",
        }),
      ],
      nameHints: [{ phone: "+15553330003", name: "David" }],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("replied")
    expect(latest[0]?.customerName).toBe("David")
    expect(latest[0]?.statusLine).toContain("Needs reply")
    expect(latest[0]?.preview).toContain("How long")
  })

  it("shows today’s completed job needing review SMS (Jason)", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [],
      completedJobs: [
        {
          id: "job-jason",
          customerPhone: "+15554440004",
          customerName: "Jason",
          location: "Oak Ave",
          summary: "Lockout",
          at: "2026-07-27T14:00:00.000Z",
          reviewSmsSentAt: null,
        },
      ],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("job_finished")
    expect(latest[0]?.headline).toContain("Jason")
    expect(latest[0]?.statusLine).toMatch(/thanks \+ review/i)
    expect(latest[0]?.completedJobId).toBe("job-jason")
  })

  it("keeps Jason when prior outbound SMS exists but review not sent", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [
        sms({
          id: "book",
          direction: "outbound",
          body: "Your appointment is confirmed for today",
          created_at: "2026-07-27T10:00:00.000Z",
          customer_phone: "+15554440004",
        }),
      ],
      completedJobs: [
        {
          id: "job-jason",
          customerPhone: "+15554440004",
          customerName: "Jason",
          location: "Oak Ave",
          summary: "Lockout",
          at: "2026-07-27T14:00:00.000Z",
        },
      ],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("job_finished")
    expect(latest[0]?.completedJobId).toBe("job-jason")
  })

  it("removes job from Latest once review SMS was sent", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [],
      completedJobs: [
        {
          id: "job-jason",
          customerPhone: "+15554440004",
          customerName: "Jason",
          location: "Oak Ave",
          summary: "Lockout",
          at: "2026-07-27T14:00:00.000Z",
          reviewSmsSentAt: "2026-07-27T15:00:00.000Z",
        },
      ],
      limit: 6,
    })
    expect(latest).toEqual([])
  })

  it("puts unreplied before jobs and caps at 6", () => {
    const messages: SmsMessage[] = []
    for (let i = 0; i < 4; i++) {
      messages.push(
        sms({
          id: `in-${i}`,
          direction: "inbound",
          body: `Reply ${i}`,
          created_at: `2026-07-27T1${i}:00:00.000Z`,
          customer_phone: `+1555100000${i}`,
        })
      )
    }
    const jobs = Array.from({ length: 4 }, (_, i) => ({
      id: `job-${i}`,
      customerPhone: `+1555200000${i}`,
      customerName: `JobCust${i}`,
      location: null,
      summary: "Done",
      at: `2026-07-27T12:0${i}:00.000Z`,
    }))
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages,
      completedJobs: jobs,
      limit: 6,
    })
    expect(latest).toHaveLength(6)
    expect(latest.slice(0, 4).every((r) => r.event === "replied")).toBe(true)
    expect(latest.slice(4).every((r) => r.event === "job_finished")).toBe(true)
  })

  it("drops stale unreplied inbound older than maxAgeHours", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      maxAgeHours: 72,
      messages: [
        sms({
          id: "old",
          direction: "inbound",
          body: "Old reply",
          created_at: "2026-07-20T12:00:00.000Z",
          customer_phone: "+15556660006",
        }),
      ],
      nameHints: [{ phone: "+15556660006", name: "Oldie" }],
      limit: 6,
    })
    expect(latest).toEqual([])
  })

  it("isHotLatestAction rejects legacy sent rows", () => {
    expect(isHotLatestAction({ event: "sent" })).toBe(false)
    expect(isHotLatestAction({ event: "replied" } as never)).toBe(true)
  })
})
