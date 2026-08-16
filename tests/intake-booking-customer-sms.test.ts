import { describe, expect, it } from "vitest"
import {
  buildIntakeBookingCustomerSmsText,
  formatAppointmentSmsTime,
} from "@/lib/intake-booking-customer-sms"

describe("intake booking confirmation SMS", () => {
  it("includes appointment time, address, and job type", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Patrick Smith",
      businessName: "Key Squad 502",
      scheduledAtIso: "2026-07-25T15:00:00.000Z",
      serviceAddress: "123 Main St, Louisville, KY",
      jobType: "Lockout",
    })
    expect(text).toContain("Hi Patrick")
    expect(text).toContain("Key Squad 502")
    expect(text).toContain("confirmed your appointment")
    expect(text).toContain("Location: 123 Main St, Louisville, KY")
    expect(text).toContain("Service: Lockout")
    expect(text).toContain("Reply here if anything changes")
  })

  it("works without a scheduled time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
    })
    expect(text).toContain("Hi Sam, Lyncr confirmed your appointment.")
    expect(text).not.toContain("Location:")
  })

  it("uses ASAP copy instead of inventing an exact time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
      isAsap: true,
      scheduledAtIso: "2026-07-25T15:00:00.000Z",
    })
    expect(text).toContain("as soon as possible")
    expect(text).not.toContain(" for ")
  })

  it("uses preferred window label instead of pin time", () => {
    const text = buildIntakeBookingCustomerSmsText({
      customerName: "Sam",
      businessName: "Lyncr",
      availabilityLabel: "Sun, Aug 16 1:00 PM–5:00 PM",
      scheduledAtIso: "2026-08-16T17:00:00.000Z",
    })
    expect(text).toContain("Preferred window: Sun, Aug 16 1:00 PM–5:00 PM")
  })

  it("formats appointment time", () => {
    const label = formatAppointmentSmsTime("2026-07-25T15:00:00.000Z")
    expect(label).toBeTruthy()
    expect(label).toMatch(/Jul/)
  })
})
