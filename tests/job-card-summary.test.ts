import { describe, expect, it } from "vitest"
import { buildJobCardSummary, jobCardTelHref } from "@/lib/job-card-summary"

describe("jobCardTelHref", () => {
  it("builds an E.164 tel link from a US number", () => {
    expect(jobCardTelHref("(502) 555-1212")).toBe("tel:+15025551212")
  })

  it("returns null when digits are too short", () => {
    expect(jobCardTelHref("555")).toBeNull()
  })
})

describe("buildJobCardSummary", () => {
  it("normalizes the same core facts for owner and tech", () => {
    const model = buildJobCardSummary({
      customer_name: "Alex Rivera",
      customer_phone: "+15025551212",
      location: "123 Main St, Louisville, KY",
      vehicle_year: "2019",
      vehicle_make: "Honda",
      vehicle_model: "Civic",
      job_type: "Lockout",
      key_style: "Remote head",
      key_fcc_id: "KR5V2X",
      quoted_price_cents: 18500,
      job_status: "en_route",
      assigned_tech_id: "tech-1",
      dispatch_status: "DISPATCHED",
      scheduled_at: "2026-07-27T15:00:00.000Z",
      field_verification_required: true,
    })

    expect(model.customerName).toBe("Alex Rivera")
    expect(model.vehicleSummary).toContain("2019 Honda Civic")
    expect(model.serviceAddress).toContain("123 Main St")
    expect(model.billingLabel).toBe("$185")
    expect(model.billingBalanceDollars).toBe(185)
    expect(model.statusPhase).toBe("en_route")
    expect(model.statusLabel).toBe("En route")
    expect(model.fieldVerificationRequired).toBe(true)
    expect(model.keyHint).toContain("KR5V2X")
    expect(model.mapsUrl).toContain("google.com/maps")
  })

  it("respects an explicit owner billingBalanceDollars override", () => {
    const model = buildJobCardSummary(
      { quoted_price_cents: 10000 },
      { billingBalanceDollars: 335 }
    )
    expect(model.billingBalanceDollars).toBe(335)
    expect(model.billingLabel).toBe("$335")
  })
})
