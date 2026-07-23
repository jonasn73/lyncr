import { describe, expect, it, beforeEach, afterEach } from "vitest"
import {
  clearIntakeDraft,
  getDraftByPhoneNumber,
  intakeDraftStorageKey,
  isIntakeDraftFresh,
  isIntakeDraftRestorable,
  loadIntakeDraft,
  normalizeIntakeDraftPhone,
  saveIntakeDraft,
  INTAKE_DRAFT_MAX_AGE_MS,
} from "@/lib/intake-draft-storage"
import type { ActiveCallFormState } from "@/lib/hooks/use-active-call-form"

const SAMPLE_FORM: ActiveCallFormState = {
  phoneNumber: "+15025551234",
  displayName: "Alex",
  serviceAddress: null,
  addressLine1: "755 Eddie Miles Road",
  addressLine2: "",
  city: "Louisville",
  region: "KY",
  postalCode: "40228",
  country: "US",
  notes: "Caller hung up mid-intake",
  jobType: "Key replacement",
  keyReplacementMode: "Origination",
  vehicleYear: "2018",
  vehicleMake: "Honda",
  vehicleModel: "Accord",
  keyFccId: "",
  keyFrequency: "",
  keyChipset: "",
  keyStyle: "",
  keyVariantId: "",
  keyProfileId: "",
  vehicleClarificationAnswers: [],
  serviceQuoteTypeId: "key_replacement",
  quotedPriceCents: 18500,
  quotedPriceOverridden: false,
  serviceVenue: "",
  customerOwnsKey: false,
  vehicleTrim: "",
  factoryOptions: [],
  plateNumber: "",
  plateState: "",
  vehicleVin: "",
  programmingMethod: "",
  tiSku: "",
  scheduledDate: "",
  scheduledTime: "",
}

describe("intake draft storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
      configurable: true,
    })
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("normalizes US phone numbers to stable storage keys", () => {
    expect(normalizeIntakeDraftPhone("(502) 555-1234")).toBe("15025551234")
    expect(intakeDraftStorageKey("+1 502-555-1234")).toBe("intake_draft_15025551234")
  })

  it("saves and reloads a draft keyed by phone number", () => {
    saveIntakeDraft("(502) 555-1234", {
      form: SAMPLE_FORM,
      currentStep: "ADDRESS_CONTACT",
      customPrice: "185",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
    })

    const loaded = loadIntakeDraft("5025551234")
    expect(loaded).not.toBeNull()
    expect(loaded!.currentStep).toBe("ADDRESS_CONTACT")
    expect(loaded!.form.displayName).toBe("Alex")
    expect(loaded!.form.vehicleModel).toBe("Accord")
    expect(loaded!.customPrice).toBe("185")
  })

  it("clears a saved draft on dismiss", () => {
    saveIntakeDraft("5025551234", {
      form: SAMPLE_FORM,
      currentStep: "VEHICLE_INFO",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
    })
    clearIntakeDraft("5025551234")
    expect(loadIntakeDraft("5025551234")).toBeNull()
  })

  it("getDraftByPhoneNumber ignores stale drafts over 2 hours", () => {
    const staleAt = new Date(Date.now() - INTAKE_DRAFT_MAX_AGE_MS - 60_000).toISOString()
    saveIntakeDraft("5025551234", {
      form: SAMPLE_FORM,
      currentStep: "SCHEDULE_TIME",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
      savedAt: staleAt,
    })
    expect(isIntakeDraftFresh({ savedAt: staleAt })).toBe(false)
    expect(getDraftByPhoneNumber("5025551234")).toBeNull()
    expect(loadIntakeDraft("5025551234")).toBeNull()
  })

  it("getDraftByPhoneNumber ignores submitted drafts", () => {
    saveIntakeDraft("5025559999", {
      form: SAMPLE_FORM,
      currentStep: "CUSTOMER_NAME",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
      submitted: true,
    })
    const raw = loadIntakeDraft("5025559999")
    expect(raw).not.toBeNull()
    expect(isIntakeDraftRestorable(raw!)).toBe(false)
    expect(getDraftByPhoneNumber("5025559999")).toBeNull()
  })

  it("getDraftByPhoneNumber returns a fresh in-progress draft", () => {
    saveIntakeDraft("5025550000", {
      form: SAMPLE_FORM,
      currentStep: "ADDRESS_CONTACT",
      customPrice: "120",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
    })
    const draft = getDraftByPhoneNumber("5025550000")
    expect(draft?.currentStep).toBe("ADDRESS_CONTACT")
    expect(draft?.form.displayName).toBe("Alex")
  })
})
