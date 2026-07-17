import { describe, expect, it } from "vitest"
import {
  buildTiCatalogSpecDescription,
  parseTiTitleYearRange,
  rankTiCatalogRows,
  scoreTiCatalogTitle,
  tiCatalogHitToManualOption,
  titleHasVehicleToken,
  type TiSupplierCatalogRow,
} from "@/lib/ti-supplier-catalog-shared"

describe("parseTiTitleYearRange", () => {
  it("parses hyphen ranges", () => {
    expect(parseTiTitleYearRange("2019 - 2024 Nissan Altima Smart Key")).toEqual({
      start: 2019,
      end: 2024,
    })
  })

  it("parses en-dash ranges", () => {
    expect(parseTiTitleYearRange("2022 – 2025 Nissan Altima Smart Prox Key")).toEqual({
      start: 2022,
      end: 2025,
    })
  })
})

describe("titleHasVehicleToken", () => {
  it("matches make and model as whole words", () => {
    const title = "2019 - 2024 Nissan Altima Smart Key 5B Trunk"
    expect(titleHasVehicleToken(title, "Nissan")).toBe(true)
    expect(titleHasVehicleToken(title, "Altima")).toBe(true)
    expect(titleHasVehicleToken(title, "Maxima")).toBe(false)
  })
})

describe("rankTiCatalogRows for 2022 Nissan Altima", () => {
  const rows: TiSupplierCatalogRow[] = [
    {
      tiSku: "TIK-NIS-85",
      crossRefTiSku: null,
      title: "2019 - 2024 Nissan Altima Sentra Smart Key 5B Trunk / Starter - KR5TXN4 - 434 MHz",
      fccId: "KR5TXN4",
      frequency: "434 MHz",
      buttonCount: 5,
      imageUrl: null,
      productUrl: "https://example.com/85",
    },
    {
      tiSku: "TIK-NIS-85A",
      crossRefTiSku: null,
      title:
        "2019 - 2024 Nissan Altima Smart Key 5B Trunk / Starter - KR5TXN4 - 434 MHz - AFTERMARKET",
      fccId: "KR5TXN4",
      frequency: "434 MHz",
      buttonCount: 5,
      imageUrl: null,
      productUrl: "https://example.com/85a",
    },
    {
      tiSku: "TIK-NIS-22",
      crossRefTiSku: null,
      title: "2007 - 2014 Nissan Altima Maxima Smart Prox Key - 4B Trunk KR55WK48903",
      fccId: "KR55WK48903",
      frequency: "315 MHz",
      buttonCount: 4,
      imageUrl: null,
      productUrl: "https://example.com/22",
    },
  ]

  it("returns TIK-NIS-85A as the primary option", () => {
    const ranked = rankTiCatalogRows(rows, 2022, "Nissan", "Altima")
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.tiSku).toBe("TIK-NIS-85A")
    expect(ranked.map((r) => r.tiSku)).not.toContain("TIK-NIS-22")
  })

  it("builds Spec + card fields for Key Details", () => {
    const ranked = rankTiCatalogRows(rows, 2022, "Nissan", "Altima")
    const primary = ranked[0]!
    expect(primary.brand).toBe("Nissan")
    expect(primary.description).toContain("KR5TXN4")
    expect(primary.description).toContain("5-Button")
    expect(primary.description).toContain("434 MHz")

    const option = tiCatalogHitToManualOption(primary)
    expect(option.catalogSku).toBe("TIK-NIS-85A")
    expect(option.supplierSku).toBe("TIK-NIS-85A")
    expect(option.brand).toBe("Nissan")
  })
})

describe("scoreTiCatalogTitle", () => {
  it("rejects out-of-range years", () => {
    expect(
      scoreTiCatalogTitle(
        "2019 - 2024 Nissan Altima Smart Key",
        "TIK-NIS-85A",
        2010,
        "Nissan",
        "Altima"
      )
    ).toBe(-1)
  })
})

describe("buildTiCatalogSpecDescription", () => {
  it("formats push-to-start proximity fob specs", () => {
    expect(
      buildTiCatalogSpecDescription({
        title: "2019 - 2024 Nissan Altima Smart Key 5B",
        fccId: "KR5TXN4",
        frequency: "434 MHz",
        buttonCount: 5,
      })
    ).toBe("Push-to-start proximity fob (FCC ID: KR5TXN4 / 5-Button / 434 MHz)")
  })
})
