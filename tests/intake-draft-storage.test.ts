import { describe, expect, it, beforeEach, afterEach } from "vitest"
import {
  clearIntakeDraft,
  intakeDraftStorageKey,
  loadIntakeDraft,
  normalizeIntakeDraftPhone,
  saveIntakeDraft,
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
})
