import { describe, expect, it } from "vitest"
import { googleMapsSearchUrl } from "@/lib/google-maps-search-url"

describe("googleMapsSearchUrl", () => {
  it("builds a Google Maps search link for the service address", () => {
    const url = googleMapsSearchUrl("123 Main St, Austin, TX 78701")
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Austin%2C%20TX%2078701"
    )
  })
})
