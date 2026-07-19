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

  it("matches 2014 RAM 1500 as exact Dodge Ram 1500 reference", () => {
    const r = lookupVehicleKeyProfiles("2014", "RAM", "1500")
    expect(r).not.toBeNull()
    expect(r?.match_type).toBe("exact")
    expect(r?.matched_model).toBe("Ram 1500")
    expect(r?.profiles.some((p) => sanitizeLoose(p.fcc_id) === "GQ453T")).toBe(true)
  })

  it("matches 2019 RAM 1500 without family fallback warning", () => {
    const r = lookupVehicleKeyProfiles("2019", "RAM", "1500")
    expect(r?.match_type).toBe("exact")
    expect(r?.profiles.map((p) => sanitizeLoose(p.fcc_id)).sort()).toEqual([
      "GQ453T",
      "OHT4882056",
    ])
  })

  it("maps Toyota Scion tC to Scion make in reference DB", () => {
    const r = lookupVehicleKeyProfiles("2014", "TOYOTA", "Scion tC")
    expect(r).not.toBeNull()
    expect(r?.matched_model).toBe("tC")
  })

  it("matches 2021 Toyota C-HR exactly", () => {
    const r = lookupVehicleKeyProfiles("2021", "Toyota", "C-HR")
    expect(r).not.toBeNull()
    expect(r?.match_type).toBe("exact")
    expect(r?.profiles.some((p) => p.fcc_id === "HYQ14AHP" || p.fcc_id === "HYQ14FBC")).toBe(true)
  })

  it("matches 2022 Toyota Corolla Cross exactly", () => {
    const r = lookupVehicleKeyProfiles("2022", "Toyota", "Corolla Cross")
    expect(r).not.toBeNull()
    expect(r?.match_type).toBe("exact")
    expect(r?.profiles.some((p) => p.fcc_id === "GQ4-73T" || p.fcc_id === "HYQ14FBC")).toBe(true)
  })

  it("resolves 2018 Volkswagen Jetta from the European CSV backup", () => {
    const r = lookupVehicleKeyProfiles("2018", "VOLKSWAGEN", "Jetta")
    expect(r).not.toBeNull()
    expect(r?.match_type).toBe("exact")
    expect(r?.profiles.some((p) => sanitizeLoose(p.fcc_id) === "NBGFS93N")).toBe(true)
  })

  it("accepts VW as an alias for Volkswagen", () => {
    const r = lookupVehicleKeyProfiles("2019", "VW", "Passat")
    expect(r).not.toBeNull()
    expect(r?.profiles.some((p) => sanitizeLoose(p.fcc_id) === "NBGFS93N")).toBe(true)
  })

  it("resolves 2016 Audi A3 from the European CSV backup", () => {
    const r = lookupVehicleKeyProfiles("2016", "AUDI", "A3")
    expect(r).not.toBeNull()
    expect(r?.profiles.some((p) => sanitizeLoose(p.fcc_id) === "NBGFS12P71")).toBe(true)
  })

  it("resolves 2010 BMW 3 Series from the European CSV backup", () => {
    const r = lookupVehicleKeyProfiles("2010", "BMW", "3 Series")
    expect(r).not.toBeNull()
    expect(r?.profiles.some((p) => sanitizeLoose(p.fcc_id) === "KR55WK49127")).toBe(true)
  })
})

function sanitizeLoose(fcc: string): string {
  return fcc.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
}
