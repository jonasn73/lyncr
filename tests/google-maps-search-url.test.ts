import { describe, expect, it } from "vitest"
import {
  googleMapsDirectionsUrl,
  googleMapsSearchUrl,
} from "@/lib/google-maps-search-url"

describe("googleMapsSearchUrl", () => {
  it("builds a search URL for an address", () => {
    expect(googleMapsSearchUrl("123 Main St")).toContain(
      "query=123%20Main%20St"
    )
  })
})

describe("googleMapsDirectionsUrl", () => {
  it("routes from the dispatcher GPS to the job", () => {
    const url = googleMapsDirectionsUrl({
      fromLat: 38.25,
      fromLng: -85.76,
      toLat: 38.3,
      toLng: -85.8,
      destinationLabel: "456 Oak Ave",
    })
    expect(url).toContain("api=1")
    expect(url).toContain("origin=38.25%2C-85.76")
    expect(url).toContain("destination=456%20Oak%20Ave")
  })

  it("falls back to destination-only when GPS is missing", () => {
    const url = googleMapsDirectionsUrl({
      toLat: 38.3,
      toLng: -85.8,
    })
    expect(url).toContain("destination=38.3%2C-85.8")
    expect(url).not.toContain("origin=")
  })
})
