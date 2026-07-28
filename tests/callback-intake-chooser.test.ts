import { describe, expect, it } from "vitest"
import {
  continueOpenQuoteStep,
  isOpenLeadPoolReady,
  resolveOpenQuoteYmm,
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

describe("isOpenLeadPoolReady / resolveOpenQuoteYmm", () => {
  it("prefers lead YMM over garage", () => {
    expect(
      resolveOpenQuoteYmm({
        lead: { vehicle_year: "2024", vehicle_make: "Ford", vehicle_model: "F-150" },
        garage: { year: "2018", make: "Toyota", model: "Camry" },
      })
    ).toEqual({ year: "2024", make: "Ford", model: "F-150" })
  })

  it("falls back to garage when lead YMM is blank", () => {
    expect(
      resolveOpenQuoteYmm({
        lead: {},
        garage: { year: "2018", make: "Toyota", model: "Camry" },
      })
    ).toEqual({ year: "2018", make: "Toyota", model: "Camry" })
  })

  it("treats address + YMM + service as pool-ready for Book → drawer", () => {
    expect(
      isOpenLeadPoolReady({
        lead: {
          service_quote_type_id: "key_generation",
          vehicle_year: "2025",
          vehicle_make: "Jeep",
          vehicle_model: "Wrangler",
          has_job_address: true,
        },
      })
    ).toBe(true)
  })

  it("keeps thin quotes off the drawer when address is missing", () => {
    expect(
      isOpenLeadPoolReady({
        lead: {
          service_quote_type_id: "key_generation",
          vehicle_year: "2025",
          vehicle_make: "Jeep",
          vehicle_model: "Wrangler",
          has_job_address: false,
        },
        customerAddressReady: false,
      })
    ).toBe(false)
  })

  it("uses customer profile address when lead collected has none", () => {
    expect(
      isOpenLeadPoolReady({
        lead: {
          service_quote_type_id: "lockout",
          vehicle_year: "2020",
          vehicle_make: "Honda",
          vehicle_model: "Civic",
          has_job_address: false,
        },
        customerAddressReady: true,
      })
    ).toBe(true)
  })
})
