import { describe, expect, it } from "vitest"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

describe("lookupVehicleKeyProfiles", () => {
  it("matches 2017 Toyota RAV4 exactly", () => {
    const r = lookupVehicleKeyProfiles("2017", "Toyota", "RAV4")
    expect(r?.match_type).toBe("exact")
    expect(r?.profiles.length).toBeGreaterThan(0)
    expect(r?.profiles[0]?.fcc_id).toBeTruthy()
  })

  it("falls back from 2017 Chevrolet 5500HD to Silverado", () => {
    const r = lookupVehicleKeyProfiles("2017", "CHEVROLET", "5500HD")
    expect(r).not.toBeNull()
    expect(r?.match_type).toBe("family")
    expect(r?.matched_model).toBe("Silverado")
    expect(r?.profiles.some((p) => p.fcc_id.includes("M3N"))).toBe(true)
  })
})
