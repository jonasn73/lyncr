import { describe, expect, it, beforeEach, afterEach } from "vitest"
import {
  clearIntakeDraft,
  getDraftByPhoneNumber,
  intakeDraftBelongsToPhone,
  intakeDraftMatchesLiveForm,
  intakeDraftPhonesMatch,
  intakeDraftStorageKey,
  isIntakeDraftFresh,
  isIntakeDraftMeaningful,
  isIntakeDraftRestorable,
  isIntakeDraftRestoreSecondary,
  loadIntakeDraft,
  normalizeIntakeDraftPhone,
  saveIntakeDraft,
  shouldOfferIntakeDraftRestore,
  wasIntakeDraftSavedDuringSession,
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

/** Blank Service + default Lockout — should never trigger Restore. */
const THIN_FORM: ActiveCallFormState = {
  ...SAMPLE_FORM,
  phoneNumber: "+15025551234",
  displayName: "",
  addressLine1: "",
  city: "",
  region: "",
  postalCode: "",
  notes: "",
  jobType: "",
  keyReplacementMode: "",
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
  serviceQuoteTypeId: "lockout",
  quotedPriceCents: 0,
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

  it("rejects overlong digit strings instead of slicing into another key", () => {
    expect(normalizeIntakeDraftPhone("15025551234999")).toBeNull()
    expect(normalizeIntakeDraftPhone("502")).toBeNull()
  })

  it("matches phones only when normalized keys agree", () => {
    expect(intakeDraftPhonesMatch("+15025551234", "(502) 555-1234")).toBe(true)
    expect(intakeDraftPhonesMatch("+15025551234", "+15025559999")).toBe(false)
    expect(intakeDraftPhonesMatch("502", "502")).toBe(false)
  })

  it("treats blank Service + Lockout as not meaningful", () => {
    expect(
      isIntakeDraftMeaningful({ form: THIN_FORM, currentStep: "SERVICE_SELECT" })
    ).toBe(false)
    expect(
      isIntakeDraftMeaningful({ form: SAMPLE_FORM, currentStep: "ADDRESS_CONTACT" })
    ).toBe(true)
  })

  it("ignores auto Lockout jobType + quote dollars on Service", () => {
    // Quote calculator fills these on a blank inbound — must not trigger Restore.
    const autoLockoutShell: ActiveCallFormState = {
      ...THIN_FORM,
      serviceQuoteTypeId: "lockout",
      jobType: "Lockout",
      quotedPriceCents: 8500,
      quotedPriceOverridden: false,
    }
    expect(
      isIntakeDraftMeaningful({ form: autoLockoutShell, currentStep: "SERVICE_SELECT" })
    ).toBe(false)

    // Same shell with empty service id (seeded inbound) but stale Lockout jobType/price.
    expect(
      isIntakeDraftMeaningful({
        form: { ...autoLockoutShell, serviceQuoteTypeId: "" },
        currentStep: "SERVICE_SELECT",
      })
    ).toBe(false)

    // Operator-locked price on Lockout still counts as progress.
    expect(
      isIntakeDraftMeaningful({
        form: { ...autoLockoutShell, quotedPriceOverridden: true },
        currentStep: "SERVICE_SELECT",
      })
    ).toBe(true)

    // Non-lockout job type on Service counts.
    expect(
      isIntakeDraftMeaningful({
        form: {
          ...THIN_FORM,
          serviceQuoteTypeId: "",
          jobType: "Key replacement",
          quotedPriceCents: 0,
        },
        currentStep: "SERVICE_SELECT",
      })
    ).toBe(true)
  })

  it("ignores mid-flow step alone when the form is still an empty shell", () => {
    // Call-switch race: previous step id + blank new-caller form must not Restore.
    expect(
      isIntakeDraftMeaningful({
        form: { ...THIN_FORM, serviceQuoteTypeId: "", jobType: "", quotedPriceCents: 0 },
        currentStep: "ADDRESS_CONTACT",
      })
    ).toBe(false)
    // Picked a service and advanced — that is real progress even with empty YMM.
    expect(
      isIntakeDraftMeaningful({
        form: { ...THIN_FORM, serviceQuoteTypeId: "lockout" },
        currentStep: "VEHICLE_INFO",
      })
    ).toBe(true)
  })

  it("does not persist thin drafts", () => {
    saveIntakeDraft("5025551234", {
      form: THIN_FORM,
      currentStep: "SERVICE_SELECT",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
    })
    expect(loadIntakeDraft("5025551234")).toBeNull()
  })

  it("saves and reloads a draft keyed by phone number", () => {
    saveIntakeDraft("(502) 555-1234", {
      form: SAMPLE_FORM,
      currentStep: "ADDRESS_CONTACT",
      customPrice: "185",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
      sourceCallLogId: "call-abc",
    })

    const loaded = loadIntakeDraft("5025551234")
    expect(loaded).not.toBeNull()
    expect(loaded!.currentStep).toBe("ADDRESS_CONTACT")
    expect(loaded!.form.displayName).toBe("Alex")
    expect(loaded!.form.vehicleModel).toBe("Accord")
    expect(loaded!.customPrice).toBe("185")
    expect(loaded!.sourceCallLogId).toBe("call-abc")
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
      form: { ...SAMPLE_FORM, phoneNumber: "+15025559999" },
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
      form: { ...SAMPLE_FORM, phoneNumber: "+15025550000" },
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

  it("getDraftByPhoneNumber clears drafts whose form phone does not match the key", () => {
    saveIntakeDraft("5025551234", {
      form: { ...SAMPLE_FORM, phoneNumber: "+15025559999" },
      currentStep: "VEHICLE_INFO",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
    })
    // saveIntakeDraft itself refuses a mismatched form phone — nothing stored.
    expect(loadIntakeDraft("5025551234")).toBeNull()
    expect(getDraftByPhoneNumber("5025551234")).toBeNull()
  })

  it("getDraftByPhoneNumber clears legacy drafts with empty form phone", () => {
    // Bypass saveIntakeDraft guards to simulate an older corrupt entry.
    const key = intakeDraftStorageKey("5025551234")!
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        data: {
          form: { ...SAMPLE_FORM, phoneNumber: "" },
          currentStep: "ADDRESS_CONTACT",
          customPrice: "",
          failureReason: "__neutral__",
          recoveredViaRouteDiscount: false,
          negotiationStep: 1,
          savedAt: new Date().toISOString(),
        },
      })
    )
    expect(intakeDraftBelongsToPhone({ form: { ...SAMPLE_FORM, phoneNumber: "" } }, "5025551234")).toBe(
      false
    )
    expect(getDraftByPhoneNumber("5025551234")).toBeNull()
    expect(loadIntakeDraft("5025551234")).toBeNull()
  })

  it("stores callerPhoneKey and only restores for that exact phone", () => {
    saveIntakeDraft("5025551234", {
      form: SAMPLE_FORM,
      currentStep: "ADDRESS_CONTACT",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
    })
    const draft = getDraftByPhoneNumber("5025551234")
    expect(draft?.callerPhoneKey).toBe("15025551234")
    expect(intakeDraftBelongsToPhone(draft!, "5025551234")).toBe(true)
    expect(intakeDraftBelongsToPhone(draft!, "5025559999")).toBe(false)
    expect(getDraftByPhoneNumber("5025559999")).toBeNull()
  })

  it("marks Restore secondary on a different call leg", () => {
    expect(
      isIntakeDraftRestoreSecondary(
        { savedAt: new Date().toISOString(), sourceCallLogId: "call-old" },
        "call-new"
      )
    ).toBe(true)
    expect(
      isIntakeDraftRestoreSecondary(
        { savedAt: new Date().toISOString(), sourceCallLogId: "call-same" },
        "call-same"
      )
    ).toBe(false)
    // Legacy drafts without a call id → secondary on any new open.
    expect(
      isIntakeDraftRestoreSecondary(
        { savedAt: new Date().toISOString(), sourceCallLogId: null },
        "call-new"
      )
    ).toBe(true)
  })

  it("treats drafts saved after session open as this-session auto-saves", () => {
    const sessionStartedAtMs = Date.now() - 5_000
    // Written during this open — do not offer Restore.
    expect(
      wasIntakeDraftSavedDuringSession(
        { savedAt: new Date(sessionStartedAtMs + 1_000).toISOString() },
        sessionStartedAtMs
      )
    ).toBe(true)
    // Written before this open — OK to offer Restore on reopen.
    expect(
      wasIntakeDraftSavedDuringSession(
        { savedAt: new Date(sessionStartedAtMs - 60_000).toISOString() },
        sessionStartedAtMs
      )
    ).toBe(false)
  })

  it("detects when the live form already matches the draft (AKL just tapped)", () => {
    const aklForm: ActiveCallFormState = {
      ...THIN_FORM,
      serviceQuoteTypeId: "all_keys_lost",
      jobType: "All keys lost",
    }
    expect(
      intakeDraftMatchesLiveForm(
        { form: aklForm, currentStep: "JOB_TYPE" },
        { form: aklForm, currentStep: "JOB_TYPE" }
      )
    ).toBe(true)
    // Blank start vs saved AKL — Restore still useful.
    expect(
      intakeDraftMatchesLiveForm(
        { form: aklForm, currentStep: "JOB_TYPE" },
        { form: THIN_FORM, currentStep: "SERVICE_SELECT" }
      )
    ).toBe(false)
  })

  it("shouldOfferIntakeDraftRestore blocks same-session and matching-form drafts", () => {
    const sessionStartedAtMs = Date.now() - 10_000
    const aklForm: ActiveCallFormState = {
      ...THIN_FORM,
      phoneNumber: "+15025551234",
      serviceQuoteTypeId: "all_keys_lost",
      jobType: "All keys lost",
    }
    // Persist a prior-session draft with real progress.
    saveIntakeDraft("5025551234", {
      form: SAMPLE_FORM,
      currentStep: "ADDRESS_CONTACT",
      customPrice: "",
      failureReason: "__neutral__",
      recoveredViaRouteDiscount: false,
      negotiationStep: 1,
      savedAt: new Date(sessionStartedAtMs - 120_000).toISOString(),
    })
    const prior = getDraftByPhoneNumber("5025551234")!
    expect(
      shouldOfferIntakeDraftRestore({
        draft: prior,
        phone: "5025551234",
        sessionStartedAtMs,
        liveForm: THIN_FORM,
        liveStep: "SERVICE_SELECT",
      })
    ).toBe(true)

    // Same content already on screen — no banner.
    expect(
      shouldOfferIntakeDraftRestore({
        draft: prior,
        phone: "5025551234",
        sessionStartedAtMs,
        liveForm: SAMPLE_FORM,
        liveStep: "ADDRESS_CONTACT",
      })
    ).toBe(false)

    // Just-saved auto-save during this open — no banner.
    const justNow = {
      ...prior,
      form: aklForm,
      currentStep: "JOB_TYPE" as const,
      savedAt: new Date(sessionStartedAtMs + 500).toISOString(),
    }
    expect(
      shouldOfferIntakeDraftRestore({
        draft: justNow,
        phone: "5025551234",
        sessionStartedAtMs,
        liveForm: aklForm,
        liveStep: "JOB_TYPE",
      })
    ).toBe(false)
  })
})
