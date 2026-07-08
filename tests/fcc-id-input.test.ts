import { describe, expect, it } from "vitest"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { lookupProfilesByFccId, lookupVehicleKeyInfo } from "@/lib/vehicle-key-reference"

describe("sanitizeFccIdInput", () => {
  it("trims, strips symbols, and uppercases", () => {
    expect(sanitizeFccIdInput("  kr5-txn1! ")).toBe("KR5TXN1")
    expect(sanitizeFccIdInput("HYQ12BBT")).toBe("HYQ12BBT")
  })
})

describe("lookupVehicleKeyInfo", () => {
  it("falls back to year/make/model when FCC ID does not match", () => {
    const result = lookupVehicleKeyInfo(2020, "Nissan", "Altima", "ZZZZNOTREAL")
    expect(result).not.toBeNull()
    expect(result?.lookup_source).toBe("ymm_fallback")
    expect(result?.profiles.length).toBeGreaterThan(0)
  })

  it("returns FCC profiles when FCC ID matches reference data", () => {
    const ymm = lookupVehicleKeyInfo(2020, "Nissan", "Altima")
    const fcc = ymm?.profiles[0]?.fcc_id
    expect(fcc).toBeTruthy()
    const result = lookupVehicleKeyInfo(2020, "Nissan", "Altima", fcc!)
    expect(result?.lookup_source).toBe("fcc")
    expect(result?.profiles.some((p) => p.fcc_id === fcc)).toBe(true)
  })

  it("matches hyphenated FCC input to compact reference rows", () => {
    const profiles = lookupProfilesByFccId("KR5-TXN1")
    expect(profiles.length).toBeGreaterThan(0)
  })
})
