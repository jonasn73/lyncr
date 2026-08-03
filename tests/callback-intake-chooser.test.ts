import { describe, expect, it } from "vitest"
import {
  continueOpenQuoteStep,
  draftClearlyChoseLockout,
  formatReturningCallerHistoryLine,
  formatReturningCallerVehicleFact,
  hasContinueableOpenLead,
  isKnownReturningCaller,
  isOpenLeadPoolReady,
  pickReturningCallerLastJob,
  resolveOpenQuoteYmm,
  resolveRestoredDraftServiceTypeId,
  resumeDraftIntakeStep,
  serviceQuoteTypeIdFromCrmHistory,
  summarizeReturningCallerNotes,
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

  it("prefers book-form AKL chip over polluted Lockout service id", () => {
    expect(
      serviceQuoteTypeIdFromCrmHistory({
        job_kind: "akl",
        service_quote_type_id: "lockout",
        job_type: "Lockout",
      })
    ).toBe("key_generation")
  })

  it("maps book-form copy chip to key duplication", () => {
    expect(serviceQuoteTypeIdFromCrmHistory({ job_kind: "copy" })).toBe("key_duplication")
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

  it("lands on Customer when vehicle + address are ready but name is not", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
      })
    ).toBe("CUSTOMER_NAME")
  })

  it("lands on Schedule when name is ready but date/time are not", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
        displayName: "Alex",
      })
    ).toBe("SCHEDULE_TIME")
  })

  it("lands on Schedule when vehicle + address + name + schedule are ready", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
        displayName: "Alex",
        scheduledDate: "2026-08-04",
        scheduledTime: "14:00",
      })
    ).toBe("SCHEDULE_TIME")
  })

  it("lands on Service when open quote has unknown type", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "",
        vehicleYear: "2017",
        vehicleMake: "Toyota",
        vehicleModel: "Yaris",
        addressReady: true,
      })
    ).toBe("SERVICE_SELECT")
  })

  it("asks for Vehicle when lockout quote is missing YMM", () => {
    expect(
      continueOpenQuoteStep({
        serviceTypeId: "lockout",
        vehicleYear: "",
        vehicleMake: "",
        vehicleModel: "",
        addressReady: true,
      })
    ).toBe("VEHICLE_INFO")
  })
})

describe("resumeDraftIntakeStep / restore Lockout clear", () => {
  it("jumps past Service when draft never left Service but form is complete enough", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: false,
        savedStep: "SERVICE_SELECT",
      })
    ).toBe("ADDRESS_CONTACT")
  })

  it("jumps Schedule drafts to Customer when name is still missing", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
        savedStep: "SCHEDULE_TIME",
        scheduledDate: "2026-08-04",
        scheduledTime: "14:00",
      })
    ).toBe("CUSTOMER_NAME")
  })

  it("keeps Schedule drafts when name and time are already filled", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
        savedStep: "SCHEDULE_TIME",
        displayName: "Alex",
        scheduledDate: "2026-08-04",
        scheduledTime: "14:00",
      })
    ).toBe("SCHEDULE_TIME")
  })

  it("advances Customer drafts to Schedule when name is filled", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: true,
        savedStep: "CUSTOMER_NAME",
        displayName: "Alex",
      })
    ).toBe("SCHEDULE_TIME")
  })

  it("advances past mid KEY_SPECIFICS when vehicle is complete (first incomplete = Address)", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "Wrangler",
        addressReady: false,
        savedStep: "KEY_SPECIFICS",
      })
    ).toBe("ADDRESS_CONTACT")
  })

  it("keeps KEY_SPECIFICS when vehicle is still incomplete", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "2025",
        vehicleMake: "Jeep",
        vehicleModel: "",
        addressReady: false,
        savedStep: "KEY_SPECIFICS",
      })
    ).toBe("KEY_SPECIFICS")
  })

  it("does not yank Address drafts back to Vehicle", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "key_generation",
        vehicleYear: "",
        vehicleMake: "",
        vehicleModel: "",
        addressReady: true,
        savedStep: "ADDRESS_CONTACT",
      })
    ).toBe("ADDRESS_CONTACT")
  })

  it("stays on Service for thin notes-only drafts", () => {
    expect(
      resumeDraftIntakeStep({
        serviceTypeId: "",
        vehicleYear: "",
        vehicleMake: "",
        vehicleModel: "",
        addressReady: false,
        savedStep: "SERVICE_SELECT",
      })
    ).toBe("SERVICE_SELECT")
  })

  it("clears false Lockout default unless draft clearly chose it", () => {
    expect(draftClearlyChoseLockout({ serviceQuoteTypeId: "lockout" }, "SERVICE_SELECT")).toBe(
      false
    )
    expect(
      draftClearlyChoseLockout(
        { serviceQuoteTypeId: "lockout", notes: "Vehicle lockout at Walmart" },
        "SERVICE_SELECT"
      )
    ).toBe(true)
    expect(
      draftClearlyChoseLockout({ serviceQuoteTypeId: "lockout" }, "ADDRESS_CONTACT")
    ).toBe(true)
    expect(
      resolveRestoredDraftServiceTypeId({
        draftServiceTypeId: "lockout",
        crmServiceTypeId: "key_generation",
        savedStep: "SERVICE_SELECT",
      })
    ).toBe("key_generation")
    expect(
      resolveRestoredDraftServiceTypeId({
        draftServiceTypeId: "lockout",
        savedStep: "SERVICE_SELECT",
      })
    ).toBe("")
  })
})

describe("isKnownReturningCaller / notes / vehicle fact", () => {
  it("treats CRM match, draft, open lead, garage, or active job as known", () => {
    expect(
      isKnownReturningCaller({
        hasMatchedCustomer: true,
        hasPendingDraft: false,
        openLeadId: null,
        garageVehicleCount: 0,
        activeJobId: null,
      })
    ).toBe(true)
    expect(
      isKnownReturningCaller({
        hasMatchedCustomer: false,
        hasPendingDraft: true,
        openLeadId: null,
        garageVehicleCount: 0,
        activeJobId: null,
      })
    ).toBe(true)
    expect(
      isKnownReturningCaller({
        hasMatchedCustomer: false,
        hasPendingDraft: false,
        openLeadId: "lead-1",
        garageVehicleCount: 0,
        activeJobId: null,
      })
    ).toBe(true)
    expect(
      isKnownReturningCaller({
        hasMatchedCustomer: false,
        hasPendingDraft: false,
        openLeadId: null,
        garageVehicleCount: 1,
        activeJobId: null,
      })
    ).toBe(true)
    expect(
      isKnownReturningCaller({
        hasMatchedCustomer: false,
        hasPendingDraft: false,
        openLeadId: null,
        garageVehicleCount: 0,
        activeJobId: "job-1",
      })
    ).toBe(true)
    expect(
      isKnownReturningCaller({
        hasMatchedCustomer: false,
        hasPendingDraft: false,
        openLeadId: null,
        garageVehicleCount: 0,
        activeJobId: null,
      })
    ).toBe(false)
  })

  it("allows Continue on open lead without a price", () => {
    expect(hasContinueableOpenLead("lead-1")).toBe(true)
    expect(hasContinueableOpenLead(null)).toBe(false)
  })

  it("strips Confirmed clarification spam and truncates notes", () => {
    const summary = summarizeReturningCallerNotes(
      "costomer need help · Confirmed Yaris iA sedan · Confirmed hatchback Yaris · Customer confirmed turn-key ignition"
    )
    expect(summary?.preview).toBe("costomer need help")
    expect(summary?.hasMore).toBe(false)

    const long = summarizeReturningCallerNotes(
      "Customer needs a spare key for the weekend trip downtown and wants evening appointment",
      40
    )
    expect(long?.preview?.endsWith("…")).toBe(true)
    expect(long?.hasMore).toBe(true)
  })

  it("formats a compact vehicle fact", () => {
    expect(
      formatReturningCallerVehicleFact({ year: "2017", make: "Toyota", model: "Yaris iA" })
    ).toBe("2017 Toyota Yaris iA")
    expect(formatReturningCallerVehicleFact({})).toBeNull()
  })

  it("picks last closed job and formats history lines", () => {
    const history = [
      {
        id: "open",
        is_open_lead: true,
        status_label: "Quote",
        summary: "Spare key",
        amount_cents: 12000,
        at: "2026-03-01T12:00:00.000Z",
      },
      {
        id: "done",
        is_open_lead: false,
        status_label: "Done",
        summary: "Key replacement",
        amount_cents: 18500,
        at: "2026-02-12T12:00:00.000Z",
      },
    ]
    expect(pickReturningCallerLastJob(history)?.id).toBe("done")
    expect(formatReturningCallerHistoryLine(history[1]!)).toContain("Done")
    expect(formatReturningCallerHistoryLine(history[1]!)).toContain("Key replacement")
    expect(formatReturningCallerHistoryLine(history[1]!)).toContain("$185")
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
