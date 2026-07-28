import { describe, expect, it } from "vitest"
import {
  continueOpenQuoteStep,
  serviceQuoteTypeIdFromCrmHistory,
} from "@/lib/callback-intake-chooser"

describe("serviceQuoteTypeIdFromCrmHistory", () => {
  it("returns null for blanks so intake does not invent Lockout", () => {
    expect(serviceQuoteTypeIdFromCrmHistory(null)).toBeNull()
    expect(serviceQuoteTypeIdFromCrmHistory({})).toBeNull()
    expect(serviceQuoteTypeIdFromCrmHistory({ service_quote_type_id: "" })).toBeNull()
  })

  it("prefers stored calculator id", () => {
    expect(
      serviceQuoteTypeIdFromCrmHistory({
        service_quote_type_id: "key_generation",
        job_type: "Lockout",
      })
    ).toBe("key_generation")
  })

  it("maps legacy aliases and job_type labels", () => {
    expect(serviceQuoteTypeIdFromCrmHistory({ service_quote_type_id: "key_gen" })).toBe(
      "key_generation"
    )
    expect(
      serviceQuoteTypeIdFromCrmHistory({ job_type: "Key replacement — Origination" })
    ).toBe("key_generation")
    expect(serviceQuoteTypeIdFromCrmHistory({ job_type: "Key replacement — Duplication" })).toBe(
      "key_duplication"
    )
  })

  it("reads key work from summary when type columns are empty", () => {
    expect(
      serviceQuoteTypeIdFromCrmHistory({ summary: "Key replacement for 2025 Jeep" })
    ).toBe("key_generation")
  })
})

describe("continueOpenQuoteStep", () => {
  it("lands on Vehicle when YMM is incomplete for key work", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "",
        addressReady: false,
      })
    ).toBe("VEHICLE_INFO")
  })

  it("lands on Address when YMM is complete but location is not", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: false,
      })
    ).toBe("ADDRESS_CONTACT")
  })

  it("lands on Schedule when vehicle + address are ready", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
      })
    ).toBe("SCHEDULE_TIME")
  })

  it("asks for Vehicle when open quote cleared service type and YMM is empty", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "",
        vehicleYear: "",
        vehicleMake: "",
        vehicleModel: "",
        addressReady: true,
      })
    ).toBe("VEHICLE_INFO")
  })
})
