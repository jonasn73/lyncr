import { describe, expect, it } from "vitest"
import {
  buildIntakeBookingCustomerSmsText,
  formatAppointmentSmsTime,
} from "@/lib/intake-booking-customer-sms"

describe("intake booking confirmation SMS", () => {
  it("includes request time, address, and job type without over-promising", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Patrick Smith",
      businessName: "Key Squad 502",
      scheduledAtIso: "2026-07-25T15:00:00.000Z",
      serviceAddress: "123 Main St, Louisville, KY",
      jobType: "Lockout",
    })
    expect(text).toContain("Hi Patrick")
    expect(text).toContain("Key Squad 502")
    expect(text).toContain("received your request")
    expect(text).toContain("We'll confirm shortly")
    expect(text).toContain("Location: 123 Main St, Louisville, KY")
    expect(text).toContain("Service: Lockout")
    expect(text).toContain("Reply here if anything changes")
    expect(text).not.toContain("confirmed your appointment")
  })

  it("works without a scheduled time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
    })
    expect(text).toContain("Hi Sam, Lyncr received your request. We'll confirm shortly.")
    expect(text).not.toContain("Location:")
  })

  it("uses ASAP copy instead of inventing an exact time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
      isAsap: true,
      scheduledAtIso: "2026-07-25T15:00:00.000Z",
    })
    expect(text).toContain("ASAP request")
    expect(text).toContain("confirm when we can get there")
    expect(text).not.toContain("arrive as soon as possible")
    expect(text).not.toContain(" for ")
  })

  it("uses preferred window label instead of pin time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
      availabilityLabel: "Sun, Aug 16 1:00 PM–5:00 PM",
      scheduledAtIso: "2026-08-16T17:00:00.000Z",
    })
    expect(text).toContain("You're free: Sun, Aug 16 1:00 PM–5:00 PM")
    expect(text).toContain("We'll confirm")
    expect(text).not.toContain("We'll confirm a time")
    expect(text).not.toContain("confirmed your appointment")
  })

  it("formats appointment time", () => {
    const label = formatAppointmentSmsTime("2026-07-25T15:00:00.000Z")
    expect(label).toBeTruthy()
    expect(label).toMatch(/Jul/)
  })
})
