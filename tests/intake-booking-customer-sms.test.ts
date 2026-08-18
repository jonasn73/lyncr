import { describe, expect, it } from "vitest"
import {
  buildIntakeBookingCustomerSmsText,
  formatAppointmentSmsTime,
} from "@/lib/intake-booking-customer-sms"

describe("intake booking confirmation SMS", () => {
  it("sounds like a person and skips street, job codes, and policy dumps", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Patrick Smith",
      businessName: "Key Squad 502",
      scheduledAtIso: "2026-07-25T15:00:00.000Z",
      serviceAddress: "123 Main St, Louisville, KY",
      jobType: "Lockout",
    })
    expect(text).toContain("Hey Patrick")
    expect(text).toContain("Key Squad 502")
    expect(text).toContain("we got your request")
    expect(text.toLowerCase()).toContain("update or change")
    expect(text).not.toContain("123 Main")
    expect(text).not.toContain("Lockout")
    expect(text.toLowerCase()).not.toContain("asap")
    expect(text.toLowerCase()).not.toContain("cancellations")
    expect(text).not.toContain("confirmed your appointment")
  })

  it("works without a scheduled time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
    })
    expect(text).toBe(
      "Hey Sam — we got your request. We’ll follow up here. Text us here for any update or change. — Lyncr"
    )
  })

  it("does not say ASAP even when the job is marked urgent", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
      isAsap: true,
      scheduledAtIso: "2026-07-25T15:00:00.000Z",
    })
    expect(text.toLowerCase()).not.toContain("asap")
    expect(text).toContain("we got your request")
    expect(text).not.toContain("arrive as soon as possible")
  })

  it("mentions the window they typed without slot language", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
      availabilityLabel: "Sun, Aug 16 1:00 PM–5:00 PM",
      scheduledAtIso: "2026-08-16T17:00:00.000Z",
    })
    expect(text).toContain("Sun, Aug 16 1:00 PM–5:00 PM")
    expect(text).not.toContain("You're free:")
    expect(text).not.toContain("We'll confirm a time")
    expect(text).not.toContain("confirmed your appointment")
  })

  it("formats appointment time", () => {
    const label = formatAppointmentSmsTime("2026-07-25T15:00:00.000Z")
    expect(label).toBeTruthy()
    expect(label).toMatch(/Jul/)
  })
})
