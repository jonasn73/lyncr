import { describe, expect, it } from "vitest"
import {
  competitiveBaseTargetDollars,
  getCompetitorDensity,
  HIGH_COMPETITION_BASE_FLOOR_DOLLARS,
  normalizeZipCode,
} from "@/lib/competitor-density"

describe("competitor-density", () => {
  it("normalizes ZIP+4 to five digits", () => {
    expect(normalizeZipCode("40216-1234")).toBe("40216")
  })

  it("flags 40216 as a high competition zone", () => {
    expect(getCompetitorDensity("40216")).toBe("high")
    expect(getCompetitorDensity("40216-0001")).toBe("high")
  })

  it("treats unknown ZIPs as standard", () => {
    expect(getCompetitorDensity("10001")).toBe("standard")
    expect(getCompetitorDensity("")).toBe("standard")
  })

  it("caps the firm-stage base at the aggressive floor in high zones", () => {
    expect(competitiveBaseTargetDollars(85, "40216")).toBe(HIGH_COMPETITION_BASE_FLOOR_DOLLARS)
    expect(competitiveBaseTargetDollars(70, "40216")).toBe(70)
    expect(competitiveBaseTargetDollars(85, "10001")).toBe(85)
  })
})
