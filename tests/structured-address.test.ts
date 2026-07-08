import { describe, expect, it } from "vitest"
import {
  isCompleteStructuredAddress,
  structuredAddressFromPhoton,
  synthesizeAddressFromQuery,
} from "@/lib/structured-address"

describe("structuredAddressFromPhoton", () => {
  it("parses partial Louisville address 5010 Roy William Place", () => {
    const addr = structuredAddressFromPhoton({
      geometry: { coordinates: [-85.6372387, 38.1778454] },
      properties: {
        housenumber: "5010",
        street: "Roy William Place",
        city: "Louisville",
        state: "Kentucky",
        postcode: "40228",
      },
    })
    expect(isCompleteStructuredAddress(addr)).toBe(true)
    expect(addr.street_number).toBe("5010")
    expect(addr.route).toBe("Roy William Place")
    expect(addr.locality).toBe("Louisville")
    expect(addr.postal_code).toBe("40228")
  })

  it("uses district or county when Photon omits city on rural streets", () => {
    const addr = structuredAddressFromPhoton({
      geometry: { coordinates: [-85.5115251, 37.7129312] },
      properties: {
        name: "Eddie Miles Road",
        district: "Culvertown",
        county: "Nelson",
        state: "Kentucky",
        postcode: "40051",
        countrycode: "US",
      },
    })
    expect(addr.route).toBe("Eddie Miles Road")
    expect(addr.locality).toBe("Culvertown")
    expect(addr.postal_code).toBe("40051")
  })
})

describe("synthesizeAddressFromQuery", () => {
  it("builds 755 Eddie Miles Road from a street-only Photon hit", () => {
    const partial = structuredAddressFromPhoton({
      geometry: { coordinates: [-85.5115251, 37.7129312] },
      properties: {
        name: "Eddie Miles Road",
        district: "Culvertown",
        state: "Kentucky",
        postcode: "40051",
        countrycode: "US",
      },
    })
    const synthesized = synthesizeAddressFromQuery("755 eddie miles r", partial)
    expect(synthesized).not.toBeNull()
    expect(isCompleteStructuredAddress(synthesized)).toBe(true)
    expect(synthesized!.street_number).toBe("755")
    expect(synthesized!.route).toBe("Eddie Miles Road")
    expect(synthesized!.formatted).toContain("Eddie Miles Road")
    expect(synthesized!.formatted.startsWith("755")).toBe(true)
    expect(synthesized!.admin_area).toBe("Kentucky")
  })
})
