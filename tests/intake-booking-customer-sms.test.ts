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

  it("formats appointment time", () => {
    const label = formatAppointmentSmsTime("2026-07-25T15:00:00.000Z")
    expect(label).toBeTruthy()
    expect(label).toMatch(/Jul/)
  })
})
