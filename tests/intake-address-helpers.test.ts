import { describe, expect, it } from "vitest"
import {
  buildFlatAddressQuery,
  listIntakeDispatchBlockers,
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

  it("returns null when street, city, or ZIP is missing", () => {
    expect(buildFlatAddressQuery({ addressLine1: "123 Main", city: "", postalCode: "40228" })).toBeNull()
  })

  it("lists dispatch blockers in plain language", () => {
    expect(
      listIntakeDispatchBlockers({
        displayName: "",
        serviceAddress: null,
        jobType: "",
        keyReplacementMode: "",
      })
    ).toEqual(["Caller name", "Service address — pick a suggestion or wait for saved address to verify", "Service type"])
  })

  it("requires key replacement mode when job type is Key replacement", () => {
    expect(
      listIntakeDispatchBlockers({
        displayName: "Allen",
        serviceAddress: {
          formatted: "5010 Roy William Place, Louisville, KY 40228",
          street_number: "5010",
          route: "Roy William Place",
          locality: "Louisville",
          postal_code: "40228",
          admin_area: "KY",
          lat: 38.2,
          lng: -85.6,
        },
        jobType: "Key replacement",
        keyReplacementMode: "",
      })
    ).toEqual(["Key replacement type (origination or duplication)"])
  })
})
