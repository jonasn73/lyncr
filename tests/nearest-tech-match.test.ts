import { describe, expect, it } from "vitest"
import { findNearestTechMatch } from "@/lib/nearest-tech-match"

describe("findNearestTechMatch", () => {
  it("returns the closest technician with live coordinates", () => {
    const match = findNearestTechMatch(38.25, -85.75, [
      {
        tech_user_id: "far",
        name: "Alex",
        status: "idle",
        latitude: 39.1,
        longitude: -84.5,
      },
      {
        tech_user_id: "near",
        name: "Jordan",
        status: "en_route",
        latitude: 38.26,
        longitude: -85.74,
      },
    ])
    expect(match?.techUserId).toBe("near")
    expect(match?.name).toBe("Jordan")
    expect(match?.miles).toBeLessThan(2)
  })
})
