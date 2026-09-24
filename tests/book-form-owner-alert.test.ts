import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildLeadAlertSmsText } from "@/lib/lead-sms-alert"

const { dispatchLeadSmsAlert, notifyOwnerLatestNeedsAttention, updateAiLeadSmsOutcome } = vi.hoisted(() => ({
  dispatchLeadSmsAlert: vi.fn(),
  notifyOwnerLatestNeedsAttention: vi.fn(),
  updateAiLeadSmsOutcome: vi.fn(),
}))

vi.mock("@/lib/intake-engine", () => ({ dispatchLeadSmsAlert }))
vi.mock("@/lib/latest-attention-sms", () => ({ notifyOwnerLatestNeedsAttention }))
vi.mock("@/lib/db", () => ({ updateAiLeadSmsOutcome }))
vi.mock("@/lib/owner-live-call", () => ({ holdBookingSourceHeadline: () => null }))

import { notifyOwnerBookFormSubmitted } from "@/lib/book-form-owner-alert"

const submission = {
  ownerUserId: "owner-1",
  leadId: "lead-1",
  callerE164: "+15025369252",
  customerName: "Alex Customer",
  address: "123 Main St",
  jobType: "All keys lost",
  vehicleYear: "2015",
  vehicleMake: "Toyota",
  vehicleModel: "Camry",
  customerEmail: "alex@example.com",
  notes: "Please call before arriving",
  urgency: "window",
  availabilityLabel: "Thursday 1–3 PM",
}

beforeEach(() => {
  vi.clearAllMocks()
  updateAiLeadSmsOutcome.mockResolvedValue(undefined)
  notifyOwnerLatestNeedsAttention.mockResolvedValue({ ok: true, sent: true })
})

describe("booking form owner alert", () => {
  it("texts the full submitted lead once through Instant alerts", async () => {
    dispatchLeadSmsAlert.mockResolvedValue({ sms_sent: true, sms_error: null })
    await notifyOwnerBookFormSubmitted(submission)

    const alert = dispatchLeadSmsAlert.mock.calls[0][0]
    const text = buildLeadAlertSmsText({
      businessName: "Key Squad 502",
      callerE164: alert.caller_e164,
      intentSlug: alert.intent_slug,
      collected: alert.collected,
      summary: alert.summary,
    })
    for (const detail of ["Alex Customer", "2015 Toyota Camry", "123 Main St", "alex@example.com", "Please call before arriving", "Thursday 1–3 PM"]) {
      expect(text).toContain(detail)
    }
    expect(notifyOwnerLatestNeedsAttention).not.toHaveBeenCalled()
  })

  it("passes the same full lead to Latest when Instant alerts are off", async () => {
    dispatchLeadSmsAlert.mockResolvedValue({ sms_sent: false, sms_error: null })
    await notifyOwnerBookFormSubmitted(submission)

    expect(notifyOwnerLatestNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "book_form",
        bookFormLead: expect.objectContaining({
          collected: expect.objectContaining({
            vehicle_year: "2015",
            vehicle_make: "Toyota",
            vehicle_model: "Camry",
            job_address: "123 Main St",
            customer_notes: "Please call before arriving",
          }),
        }),
      })
    )
  })
})
