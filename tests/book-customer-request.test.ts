import { describe, expect, it } from "vitest"
import {
  bookFormSeedFromIntakePrefill,
  bookingIntakePrefillFromCollected,
  bookJobKindNeedsVehicle,
  bookWindowStartIso,
  buildBookCollectedExtras,
  buildBookDayOptions,
  formatBookAvailabilityLabel,
  formatBookTimeLabel,
  isValidBookTimeRange,
  jobTypeFromBookFormKind,
} from "@/lib/book-customer-request"

describe("book customer request helpers", () => {
  it("maps job kinds like Activity book link", () => {
    expect(jobTypeFromBookFormKind("lockout")).toBe("Lockout")
    expect(jobTypeFromBookFormKind("copy")).toContain("Duplication")
    expect(jobTypeFromBookFormKind("akl")).toContain("Origination")
  })

  it("shows vehicle fields for car-key jobs only", () => {
    expect(bookJobKindNeedsVehicle("lockout")).toBe(false)
    expect(bookJobKindNeedsVehicle("copy")).toBe(true)
    expect(bookJobKindNeedsVehicle("akl")).toBe(true)
    expect(bookJobKindNeedsVehicle("other")).toBe(false)
  })

  it("offers today + next day chips only", () => {
    const days = buildBookDayOptions(new Date("2026-08-03T15:00:00"))
    expect(days).toHaveLength(2)
    expect(days[0]?.shortLabel).toBe("Today")
    expect(days[1]?.shortLabel).toBe("Next day")
  })

  it("validates from–to ranges", () => {
    expect(isValidBookTimeRange("13:00", "17:30")).toBe(true)
    expect(isValidBookTimeRange("17:30", "13:00")).toBe(false)
    expect(isValidBookTimeRange("13:00", "13:00")).toBe(false)
  })

  it("formats availability like “Today 1:00 PM–5:30 PM”", () => {
    expect(formatBookTimeLabel("13:00")).toBe("1:00 PM")
    expect(
      formatBookAvailabilityLabel({
        dateKey: "2026-08-03",
        fromHhmm: "13:00",
        toHhmm: "17:30",
        dayShortLabel: "Today",
      })
    ).toBe("Today 1:00 PM–5:30 PM")
  })

  it("builds collected extras for ASAP vs window", () => {
    const asap = buildBookCollectedExtras({ urgency: "asap", email: "a@b.com" })
    expect(asap.is_asap).toBe(true)
    expect(asap.availability).toBe("ASAP / emergency")

    const window = buildBookCollectedExtras({
      urgency: "window",
      availabilityDate: "2026-08-03",
      availabilityFrom: "13:00",
      availabilityTo: "17:30",
      availabilityLabel: "Today 1:00 PM–5:30 PM",
    })
    expect(window.is_asap).toBe(false)
    expect(window.availability_from).toBe("13:00")
    expect(window.preferred_window).toBe("Today 1:00 PM–5:30 PM")
  })

  it("turns window start into an ISO timestamp for deposit holds", () => {
    const iso = bookWindowStartIso("2026-08-03", "13:00")
    expect(iso).toBeTruthy()
    expect(Number.isNaN(Date.parse(iso!))).toBe(false)
  })
})

describe("hold-intake booking prefill", () => {
  it("normalizes call_queue.collected into an invite prefill", () => {
    expect(
      bookingIntakePrefillFromCollected({
        intent_slug: "locksmith_key_generation",
        intent_label: "Lost key / needs new key made",
        vehicle_year: "2015",
        vehicle_year_label: "Year 2015",
      })
    ).toEqual({
      intent_slug: "locksmith_key_generation",
      intent_label: "Lost key / needs new key made",
      vehicle_year: "2015",
    })
  })

  it("returns null for empty or junk collected blobs", () => {
    expect(bookingIntakePrefillFromCollected(null)).toBeNull()
    expect(bookingIntakePrefillFromCollected({})).toBeNull()
    expect(bookingIntakePrefillFromCollected({ vehicle_year: "20xx" })).toBeNull()
  })

  it("seeds the /book form from locksmith intake answers", () => {
    expect(
      bookFormSeedFromIntakePrefill({
        intent_slug: "locksmith_key_generation",
        intent_label: "Lost key / needs new key made",
        vehicle_year: "2015",
      })
    ).toEqual({ jobKind: "akl", jobOther: "", vehicleYear: "2015", vehicleMake: "", vehicleModel: "" })
    expect(
      bookFormSeedFromIntakePrefill({ intent_slug: "locksmith_lockout" })
    ).toEqual({ jobKind: "lockout", jobOther: "", vehicleYear: "", vehicleMake: "", vehicleModel: "" })
    expect(
      bookFormSeedFromIntakePrefill({ intent_slug: "locksmith_property" })
    ).toEqual({ jobKind: "lockout", jobOther: "", vehicleYear: "", vehicleMake: "", vehicleModel: "" })
  })

  it("routes non-locksmith intents to the Other chip with their label", () => {
    expect(
      bookFormSeedFromIntakePrefill({ intent_slug: "roofing_emergency", intent_label: "Active leak" })
    ).toEqual({ jobKind: "other", jobOther: "Active leak", vehicleYear: "", vehicleMake: "", vehicleModel: "" })
  })

  it("leaves the chip unpicked for locksmith_other (no real signal)", () => {
    expect(
      bookFormSeedFromIntakePrefill({ intent_slug: "locksmith_other", intent_label: "Something else" })
    ).toBeNull()
    // …but still carries a captured year if one exists.
    expect(
      bookFormSeedFromIntakePrefill({ intent_slug: "locksmith_other", vehicle_year: "2015" })
    ).toEqual({ jobKind: "", jobOther: "", vehicleYear: "2015", vehicleMake: "", vehicleModel: "" })
  })
})
