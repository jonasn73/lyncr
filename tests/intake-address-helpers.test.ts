import { describe, expect, it } from "vitest"
import {
  buildFlatAddressQuery,
  isIntakeAddressReady,
  listIntakeDispatchBlockers,
  parseLooseAddressQuery,
} from "@/lib/intake-address-helpers"

describe("intake address helpers", () => {
  it("builds a geocode query from flat customer fields", () => {
    expect(
      buildFlatAddressQuery({
        addressLine1: "5010 Roy William Place",
        city: "Louisville",
        region: "KY",
        postalCode: "40228",
      })
    ).toBe("5010 Roy William Place, Louisville, KY, 40228")
  })

  it("seeds Location from a book-form single line when city is missing", () => {
    expect(
      buildFlatAddressQuery({ addressLine1: "1079 Cherokee rd 40204", city: "", postalCode: "" })
    ).toBe("1079 Cherokee rd 40204")
  })

  it("returns null when street is missing", () => {
    expect(buildFlatAddressQuery({ addressLine1: "", city: "Louisville", postalCode: "40228" })).toBeNull()
  })

  it("parses a typed comma-separated address", () => {
    expect(parseLooseAddressQuery("5010 Roy William Place, Louisville, KY 40228")).toEqual({
      addressLine1: "5010 Roy William Place",
      city: "Louisville",
      region: "KY",
      postalCode: "40228",
    })
  })

  it("parses a single-line book-form address with city state zip", () => {
    const parsed = parseLooseAddressQuery("2440 Bardstown rd Louisville KY 40205")
    expect(parsed.postalCode).toBe("40205")
    expect(parsed.region).toBe("KY")
    expect(parsed.city.toLowerCase()).toBe("louisville")
    expect(parsed.addressLine1.toLowerCase()).toContain("bardstown")
  })

  it("treats a substantial street-only book-form line as dispatch-ready", () => {
    expect(
      isIntakeAddressReady({
        serviceAddress: null,
        addressLine1: "1079 Cherokee rd 40204",
        city: "",
      })
    ).toBe(true)
  })

  it("accepts flat street + city for dispatch readiness", () => {
    expect(
      isIntakeAddressReady({
        serviceAddress: null,
        addressLine1: "5010 Roy William Place",
        city: "Louisville",
      })
    ).toBe(true)
  })

  it("lists dispatch blockers in plain language", () => {
    expect(
      listIntakeDispatchBlockers({
        displayName: "",
        serviceAddress: null,
        addressLine1: "",
        city: "",
      })
    ).toEqual(["Caller name", "Service address (street + city, or pick a suggestion)"])
  })
})
