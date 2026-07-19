import { describe, expect, it } from "vitest"
import {
  filterModelsForYear,
  getVehicleModelYearRange,
  isVehicleYearMakeModelValid,
} from "@/lib/vehicle-model-year-ranges"
import { rankTiCatalogRows, type TiSupplierCatalogRow } from "@/lib/ti-supplier-catalog-shared"
import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

describe("vehicle model year ranges", () => {
  it("marks Chevrolet Cruze as hard-ended in 2019", () => {
    const range = getVehicleModelYearRange("Chevrolet", "Cruze")
    expect(range).toEqual({ start: 2010, end: 2019 })
    expect(isVehicleYearMakeModelValid(2019, "CHEVROLET", "CRUZE")).toBe(true)
    expect(isVehicleYearMakeModelValid(2020, "CHEVROLET", "CRUZE")).toBe(false)
    expect(isVehicleYearMakeModelValid(2022, "Chevrolet", "Cruze")).toBe(false)
  })

  it("does not hard-filter still-sold models just because FCC data stops early", () => {
    // Silverado may only appear through ~2021 in the FCC CSV — still valid for 2022+.
    expect(getVehicleModelYearRange("CHEVROLET", "SILVERADO")).toBeNull()
    expect(isVehicleYearMakeModelValid(2022, "CHEVROLET", "Silverado")).toBe(true)
    expect(isVehicleYearMakeModelValid(2024, "CHEVROLET", "Malibu")).toBe(true)
  })

  it("filters Cruze out of a 2022 Chevrolet model list", () => {
    const filtered = filterModelsForYear("CHEVROLET", 2022, [
      "Cruze",
      "Silverado",
      "Malibu",
      "Equinox",
    ])
    expect(filtered).toEqual(["Silverado", "Malibu", "Equinox"])
  })

  it("keeps Cruze in a 2018 Chevrolet model list", () => {
    const filtered = filterModelsForYear("CHEVROLET", 2018, ["Cruze", "Silverado"])
    expect(filtered).toEqual(["Cruze", "Silverado"])
  })
})

describe("impossible YMM must not invent keys", () => {
  it("returns no FCC profiles for 2022 Cruze", () => {
    expect(lookupVehicleKeyProfiles(2022, "CHEVROLET", "Cruze")).toBeNull()
  })

  it("returns no TI platform matches for 2022 Cruze", () => {
    const rows: TiSupplierCatalogRow[] = [
      {
        tiSku: "TIK-CHV-143A",
        crossRefTiSku: null,
        title: "2022-2026 Chevrolet Smart Key",
        fccId: "YGOG21TB2",
        frequency: "433 MHz",
        buttonCount: 4,
        imageUrl: null,
        productUrl: "https://example.com",
      },
    ]
    expect(rankTiCatalogRows(rows, 2022, "CHEVROLET", "Cruze")).toEqual([])
  })

  it("still ranks TI hits for a valid Cruze year when the title names Cruze", () => {
    const rows: TiSupplierCatalogRow[] = [
      {
        tiSku: "TIK-CHV-099A",
        crossRefTiSku: null,
        title: "2016-2019 Chevrolet Cruze Smart Key",
        fccId: "ABC123",
        frequency: "315 MHz",
        buttonCount: 4,
        imageUrl: null,
        productUrl: "https://example.com",
      },
    ]
    const ranked = rankTiCatalogRows(rows, 2018, "CHEVROLET", "Cruze")
    expect(ranked.length).toBe(1)
    expect(ranked[0]?.tiSku).toBe("TIK-CHV-099A")
  })
})
