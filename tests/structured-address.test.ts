import { describe, expect, it } from "vitest"
import { isCompleteStructuredAddress, structuredAddressFromPhoton } from "@/lib/structured-address"

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
})
