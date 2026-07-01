import { describe, expect, it } from "vitest"
import {
  assertMustHaveClarificationPrompts,
  getVehicleIntakeClarifications,
} from "@/lib/vehicle-intake-clarifications"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

describe("vehicle intake clarifications", () => {
  it("offers prompts for known ambiguous YMM combos", () => {
    const failures = assertMustHaveClarificationPrompts()
    expect(failures, `Missing clarifications for: ${failures.join(", ")}`).toEqual([])
  })

  it("asks Yaris body style before assuming Yaris iA", () => {
    const prompts = getVehicleIntakeClarifications(2017, "Toyota", "Yaris")
    expect(prompts.some((p) => p.id === "yaris-body-style")).toBe(true)
    expect(prompts.some((p) => p.id === "yaris-ignition-type")).toBe(true)
  })

  it("resolves 2017 Toyota Yaris hatch to HYQ12BBY not Yaris iA smart key", () => {
    const result = lookupVehicleKeyProfiles("2017", "Toyota", "Yaris")
    expect(result?.match_type).toBe("exact")
    expect(result?.matched_model).toBe("Yaris")
    expect(result?.profiles.some((p) => p.fcc_id === "HYQ12BBY")).toBe(true)
    expect(result?.profiles.some((p) => p.fcc_id === "WAZSKE13D02")).toBe(false)
  })

  it("resolves 2017 Toyota Yaris iA to smart key FCC", () => {
    const result = lookupVehicleKeyProfiles("2017", "Toyota", "Yaris iA")
    expect(result?.profiles.some((p) => p.fcc_id === "WAZSKE13D02")).toBe(true)
  })
})
