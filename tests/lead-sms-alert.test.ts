import { describe, expect, it } from "vitest"
import { buildLeadAlertSmsText } from "@/lib/lead-sms-alert"

describe("buildLeadAlertSmsText", () => {
  it("formats the owner alert with vehicle and service details", () => {
    const text = buildLeadAlertSmsText({
      businessName: "Key Squad Locksmith",
      callerE164: "+15025551234",
      intentSlug: "car_key",
      collected: {
        vehicle_year: "2019",
        vehicle_make: "Honda",
        vehicle_model: "Accord",
        issue_summary: "Lost keys at grocery store parking lot",
      },
      summary: "Caller needs a spare programmed key",
    })

    expect(text).toContain("Lyncr Lead")
    expect(text).toContain("Business: Key Squad Locksmith")
    expect(text).toContain("Caller: +15025551234")
    expect(text).toContain("2019 Honda Accord")
    expect(text).toContain("Service: Car Key")
    expect(text).toContain("Lost keys at grocery store parking lot")
  })

  it("includes all submitted booking fields in the owner SMS", () => {
    const text = buildLeadAlertSmsText({
      businessName: "Key Squad 502",
      callerE164: "+15025369252",
      intentSlug: null,
      collected: {
        customer_name: "Alex Customer",
        service_type: "All keys lost",
        vehicle_year: "2015",
        vehicle_make: "Toyota",
        vehicle_model: "Camry",
        job_address: "123 Main St, Louisville, KY",
        customer_email: "alex@example.com",
        customer_notes: "Please call before arriving",
        urgency: "window",
        availability: "Thursday 1–3 PM",
      },
      summary: "All keys lost — Alex Customer",
    })

    for (const detail of [
      "Alex Customer",
      "+15025369252",
      "All keys lost",
      "2015 Toyota Camry",
      "123 Main St, Louisville, KY",
      "alex@example.com",
      "Please call before arriving",
      "Thursday 1–3 PM",
    ]) expect(text).toContain(detail)
  })

  it("shows the keypad ZIP on a hold lead SMS", () => {
    const text = buildLeadAlertSmsText({
      businessName: "Key Squad 502",
      callerE164: "+15025369252",
      intentSlug: "locksmith_key_generation",
      collected: {
        intent_label: "Lost key / needs new key made",
        job_address_postal_code: "40202",
      },
      summary: "Caller on hold — Lost key / needs new key made — ZIP code 40202",
    })
    expect(text).toContain("ZIP: 40202")
    expect(text).toContain("Service: Lost key / needs new key made")
    expect(text).toContain("Status: Waiting on hold")
    expect(text).not.toContain("Notes:")
    expect(text.match(/40202/g)).toHaveLength(1)
    expect(text.match(/Lost key \/ needs new key made/g)).toHaveLength(1)
  })
})
