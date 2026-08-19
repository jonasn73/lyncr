import { describe, expect, it } from "vitest"
import {
  buildLatestCustomerActions,
  classifyOutboundSmsKind,
  isFreshLatestPaintItem,
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
      maxAgeHours: 24,
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
    expect(isHotLatestAction({ event: "customer_paid" } as never)).toBe(true)
    expect(isHotLatestAction({ event: "book_form" } as never)).toBe(true)
  })

  it("isFreshLatestPaintItem drops unreplied inbound older than 24h", () => {
    const now = Date.parse("2026-08-16T20:00:00.000Z")
    expect(
      isFreshLatestPaintItem(
        {
          id: "r-old",
          customerPhone: "+15551110001",
          customerName: "Old",
          event: "replied",
          kind: "other",
          headline: "Old replied",
          statusLine: "Needs reply",
          preview: "hi",
          at: "2026-08-14T20:00:00.000Z",
          deliveryLabel: null,
          reviewLinkOpened: false,
          reviewLinkClicks: 0,
          lastOutbound: null,
          lastInbound: null,
        },
        now
      )
    ).toBe(false)
    expect(
      isFreshLatestPaintItem(
        {
          id: "r-new",
          customerPhone: "+15551110001",
          customerName: "New",
          event: "replied",
          kind: "other",
          headline: "New replied",
          statusLine: "Needs reply",
          preview: "hi",
          at: "2026-08-16T10:00:00.000Z",
          deliveryLabel: null,
          reviewLinkOpened: false,
          reviewLinkClicks: 0,
          lastOutbound: null,
          lastInbound: null,
        },
        now
      )
    ).toBe(true)
  })

  it("surfaces book_form ASAP submits", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [],
      bookForms: [
        {
          id: "lead-jonas",
          customerPhone: "+15025369252",
          customerName: "Jonas Rwibuka",
          at: "2026-07-27T19:08:00.000Z",
          urgency: "asap",
          availabilityLabel: "ASAP / emergency",
          preview: "Keys lost (AKL) · 2010 Honda Civic · 5010 Roy William Pl",
          jobKind: "akl",
          jobType: "Key replacement (Origination)",
          serviceQuoteTypeId: "key_generation",
          vehicleYear: "2010",
          vehicleMake: "Honda",
          vehicleModel: "Civic",
          addressLine1: "5010 Roy William Pl",
        },
      ],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("book_form")
    expect(latest[0]?.headline).toBe("Customer submitted book form · ASAP")
    expect(latest[0]?.bookFormLeadId).toBe("lead-jonas")
    expect(latest[0]?.customerName).toBe("Jonas Rwibuka")
    expect(latest[0]?.bookFormJobKind).toBe("akl")
    expect(latest[0]?.bookFormVehicleYear).toBe("2010")
    expect(latest[0]?.bookFormAddressLine1).toBe("5010 Roy William Pl")
  })

  it("keeps book_form when the same phone also texted (so Messages can show filled)", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [
        sms({
          id: "i-isaac",
          direction: "inbound",
          body: "when could you come",
          created_at: "2026-07-27T19:40:00.000Z",
          customer_phone: "+15028762058",
          from_number: "+15028762058",
        }),
      ],
      bookForms: [
        {
          id: "lead-isaac",
          customerPhone: "+15028762058",
          customerName: "Isaac Kontcho",
          at: "2026-07-27T12:00:00.000Z",
          urgency: "asap",
          availabilityLabel: "ASAP / emergency",
          preview: "Keys lost · 2011 BMW 128i",
        },
      ],
      limit: 6,
    })
    expect(latest.some((row) => row.event === "replied")).toBe(true)
    expect(latest.some((row) => row.event === "book_form" && row.bookFormLeadId === "lead-isaac")).toBe(
      true
    )
  })

  it("surfaces customer_paid from recent wallet settles", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [],
      recentPayments: [
        {
          id: "wt-1",
          customerPhone: "+15557770007",
          customerName: "Alex",
          amountCents: 26500,
          at: "2026-07-27T19:30:00.000Z",
          jobId: "job-alex",
          jobLabel: "2019 Honda Civic",
        },
      ],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("customer_paid")
    expect(latest[0]?.headline).toContain("$265")
    expect(latest[0]?.headline).toContain("Alex")
    expect(latest[0]?.paidAmountCents).toBe(26500)
    expect(latest[0]?.completedJobId).toBe("job-alex")
    expect(latest[0]?.thanksReviewPending).toBe(false)
  })

  it("merges payment + thanks into one alert for the same job/customer", () => {
    const latest = buildLatestCustomerActions({
      nowMs: NOW,
      messages: [],
      recentPayments: [
        {
          id: "wt-nate",
          customerPhone: "+15025550195",
          customerName: "Nathaniel Thompson",
          amountCents: 19500,
          at: "2026-07-27T19:10:00.000Z",
          jobId: "job-nate",
          jobLabel: "2004 LINCOLN Aviator",
        },
      ],
      completedJobs: [
        {
          id: "job-nate",
          customerPhone: "+15025550195",
          customerName: "Nathaniel Thompson",
          location: "Louisville KY",
          summary: "Lockout",
          at: "2026-07-27T19:05:00.000Z",
          reviewSmsSentAt: null,
        },
      ],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("customer_paid")
    expect(latest[0]?.thanksReviewPending).toBe(true)
    expect(latest[0]?.statusLine).toMatch(/send thanks/i)
    expect(latest[0]?.completedJobId).toBe("job-nate")
    expect(latest[0]?.paidAmountCents).toBe(19500)
  })

  it("keeps job_finished when completed_at is evening ET (UTC next calendar day)", () => {
    // 8:45pm ET Jul 27 = 00:45 UTC Jul 28 — server UTC “today” would miss this job.
    const latest = buildLatestCustomerActions({
      nowMs: Date.parse("2026-07-28T00:45:00.000Z"),
      messages: [],
      completedJobs: [
        {
          id: "0649fe4d-d5e6-4994-9f17-d38ea6b17662",
          customerPhone: "+15023818063",
          customerName: "Jason",
          location: null,
          summary: "Key replacement — Origination",
          at: "2026-07-27T23:50:55.807Z",
          reviewSmsSentAt: null,
        },
      ],
      limit: 6,
    })
    expect(latest).toHaveLength(1)
    expect(latest[0]?.event).toBe("job_finished")
    expect(latest[0]?.customerName).toBe("Jason")
    expect(latest[0]?.completedJobId).toBe("0649fe4d-d5e6-4994-9f17-d38ea6b17662")
  })
})
