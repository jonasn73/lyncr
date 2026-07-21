import { describe, expect, it } from "vitest"
import {
  formatCompatibleVehicleSummary,
  lookupCompatibleVehiclesForFcc,
  lookupVehicleKeyProfiles,
} from "@/lib/vehicle-key-reference"

describe("lookupCompatibleVehiclesForFcc", () => {
  it("lists multiple Ford models for OUCD6000022", () => {
    const vehicles = lookupCompatibleVehiclesForFcc("OUCD6000022")
    // CSV stores make/model in uppercase (ESCAPE / FUSION).
    expect(vehicles.some((v) => /escape/i.test(v.model))).toBe(true)
    expect(vehicles.some((v) => /fusion/i.test(v.model))).toBe(true)
    expect(vehicles.length).toBeGreaterThan(5)
  })

  it("matches hyphenated and compact FCC IDs", () => {
    const hyphen = lookupCompatibleVehiclesForFcc("N5F-A08TAA")
    const compact = lookupCompatibleVehiclesForFcc("N5FA08TAA")
    expect(hyphen.length).toBe(compact.length)
  })

  it("matches Conti FCC IDs when TI omits trailing 00", () => {
    const withZeros = lookupCompatibleVehiclesForFcc("M3NA2C93142300")
    const withoutZeros = lookupCompatibleVehiclesForFcc("M3NA2C931423")
    expect(withZeros.length).toBe(withoutZeros.length)
    expect(withZeros.length).toBeGreaterThan(0)
  })
})

describe("formatCompatibleVehicleSummary", () => {
  it("puts the current make/model first and collapses year ranges", () => {
    const vehicles = lookupCompatibleVehiclesForFcc("OUCD6000022")
    const summary = formatCompatibleVehicleSummary(vehicles, {
      year: 2018,
      make: "Ford",
      model: "Escape",
    })
    expect(summary.lines[0]).toMatch(/2018\s+Ford\s+Escape/i)
    expect(summary.lines.some((line) => /Ford Escape \(\d{4}–\d{4}\)/i.test(line))).toBe(true)
  })
})

describe("2018 Ford Escape FCC profiles", () => {
  it("returns separate FCC IDs for the exact vehicle", () => {
    const r = lookupVehicleKeyProfiles("2018", "Ford", "Escape")
    expect(r?.match_type).toBe("exact")
    expect(r?.profiles.length).toBeGreaterThanOrEqual(2)
    const fccIds = r!.profiles.map((p) => p.fcc_id)
    expect(fccIds).toContain("M3N5WY8609")
    expect(fccIds).toContain("OUCD6000022")
  })
})
