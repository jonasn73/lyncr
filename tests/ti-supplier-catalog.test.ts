import { describe, expect, it } from "vitest"
import {
  buildTiCatalogSpecDescription,
  expandMakeSearchAliases,
  expandModelSearchAliases,
  parseTiTitleYearRange,
  rankTiCatalogRows,
  scoreTiCatalogTitle,
  tiCatalogHitToManualOption,
  titleHasVehicleToken,
  titleMatchesMake,
  titleMatchesModel,
  type TiSupplierCatalogRow,
} from "@/lib/ti-supplier-catalog-shared"

describe("parseTiTitleYearRange", () => {
  it("parses hyphen ranges at the start", () => {
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

  it("parses mid-title Strattec ranges (2016 Equinox case)", () => {
    expect(
      parseTiTitleYearRange(
        "Strattec 2010 - 2018 Chevrolet Equinox Sonic Spark Trax Remote Flip Key - 3B - 5913598"
      )
    ).toEqual({ start: 2010, end: 2018 })
  })
})

describe("expandMakeSearchAliases", () => {
  it("maps CHEVROLET to Chevy spellings", () => {
    const aliases = expandMakeSearchAliases("CHEVROLET").map((a) => a.toLowerCase())
    expect(aliases).toContain("chevrolet")
    expect(aliases).toContain("chevy")
  })

  it("maps Chevy back to Chevrolet", () => {
    const aliases = expandMakeSearchAliases("Chevy").map((a) => a.toLowerCase())
    expect(aliases).toContain("chevrolet")
    expect(aliases).toContain("chevy")
  })

  it("maps VW / Volkswagen both ways", () => {
    expect(expandMakeSearchAliases("VW").map((a) => a.toLowerCase())).toContain("volkswagen")
    expect(expandMakeSearchAliases("Volkswagen").map((a) => a.toLowerCase())).toContain("vw")
  })

  it("maps RAM / Dodge", () => {
    expect(expandMakeSearchAliases("RAM").map((a) => a.toLowerCase())).toContain("dodge")
    expect(expandMakeSearchAliases("Dodge").map((a) => a.toLowerCase())).toContain("ram")
  })
})

describe("titleMatchesMake", () => {
  it("matches Chevrolet titles when intake make is CHEVY", () => {
    expect(
      titleMatchesMake(
        "Strattec 2010 - 2018 Chevrolet Equinox Sonic Spark Trax Remote Flip Key",
        "CHEVY"
      )
    ).toBe(true)
  })
})

describe("expandModelSearchAliases", () => {
  it("expands CX-3 hyphen / space / compact spellings", () => {
    const aliases = expandModelSearchAliases("CX-3").map((a) => a.toLowerCase())
    expect(aliases).toContain("cx-3")
    expect(aliases).toContain("cx3")
    expect(aliases).toContain("cx 3")
  })

  it("expands F-150 family spellings", () => {
    const aliases = expandModelSearchAliases("F150").map((a) => a.toLowerCase())
    expect(aliases).toContain("f150")
    expect(aliases).toContain("f-150")
  })
})

describe("titleHasVehicleToken", () => {
  it("matches make and model as whole words", () => {
    const title = "2019 - 2024 Nissan Altima Smart Key 5B Trunk"
    expect(titleHasVehicleToken(title, "Nissan")).toBe(true)
    expect(titleHasVehicleToken(title, "Altima")).toBe(true)
    expect(titleHasVehicleToken(title, "Maxima")).toBe(false)
  })

  it("matches CX3 against a CX-3 title via compact form", () => {
    expect(
      titleHasVehicleToken(
        "2012 - 2018 Mazda 3 5 Door CX-3 CX-5 Smart Key 3B",
        "CX3"
      )
    ).toBe(true)
  })
})

describe("titleMatchesModel", () => {
  it("matches CX-3 aliases inside multi-fit Mazda titles", () => {
    expect(
      titleMatchesModel(
        "2012 - 2018 Mazda 3 5 Door CX-3 CX-5 Smart Key 3B - WAZSKE13D01",
        "CX-3"
      )
    ).toBe(true)
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

describe("rankTiCatalogRows for 2016 Chevrolet Equinox", () => {
  const rows: TiSupplierCatalogRow[] = [
    {
      tiSku: "TIK-GM-66",
      crossRefTiSku: null,
      title: "Strattec 2010 - 2018 Chevrolet Equinox Sonic Spark Trax Remote Flip Key - 3B - 5913598",
      fccId: "",
      frequency: "",
      buttonCount: 3,
      imageUrl: null,
      productUrl: "https://example.com/gm66",
    },
    {
      tiSku: "TIK-GM-84",
      crossRefTiSku: null,
      title:
        "Strattec 2010 - 2021 Chevrolet Equinox Sonic Remote Flip Key - 4B Remote Start - 5913597",
      fccId: "",
      frequency: "",
      buttonCount: 4,
      imageUrl: null,
      productUrl: "https://example.com/gm84",
    },
    {
      tiSku: "TIK-CHV-92",
      crossRefTiSku: null,
      title: "2018 - 2021 Chevrolet Equinox Smart Key 5B Hatch / Remote Start - HYQ4AA 13529650",
      fccId: "HYQ4AA",
      frequency: "434 MHz",
      buttonCount: 5,
      imageUrl: null,
      productUrl: "https://example.com/chv92",
    },
  ]

  it("matches CHEVROLET + Equinox + 2016 against Strattec year ranges", () => {
    const ranked = rankTiCatalogRows(rows, 2016, "CHEVROLET", "Equinox")
    expect(ranked.map((r) => r.tiSku)).toContain("TIK-GM-66")
    expect(ranked.map((r) => r.tiSku)).toContain("TIK-GM-84")
    expect(ranked.map((r) => r.tiSku)).not.toContain("TIK-CHV-92")
  })

  it("matches when intake make is Chevy instead of Chevrolet", () => {
    const ranked = rankTiCatalogRows(rows, 2016, "Chevy", "Equinox")
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.some((r) => r.tiSku.startsWith("TIK-GM-"))).toBe(true)
  })
})

describe("scoreTiCatalogTitle", () => {
  it("rejects years far outside the printed range", () => {
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

  it("accepts 2016 inside a mid-title 2010-2018 range", () => {
    expect(
      scoreTiCatalogTitle(
        "Strattec 2010 - 2018 Chevrolet Equinox Sonic Spark Trax Remote Flip Key - 3B",
        "TIK-GM-66",
        2016,
        "CHEVROLET",
        "Equinox"
      )
    ).toBeGreaterThan(0)
  })

  it("soft-matches a model title one year past the printed end", () => {
    expect(
      scoreTiCatalogTitle(
        "2012 - 2018 Mazda 3 5 Door CX-3 CX-5 Smart Key 3B - WAZSKE13D01",
        "TIK-MAZ-46",
        2019,
        "Mazda",
        "CX-3"
      )
    ).toBeGreaterThan(0)
  })

  it("accepts exact-year make platform smart keys without a model name", () => {
    expect(
      scoreTiCatalogTitle(
        "2019 - 2025 Mazda Smart Key 3B - WAZSKE11D01 BCYN-67-5DY",
        "TIK-MAZ-66",
        2019,
        "Mazda",
        "CX-3"
      )
    ).toBeGreaterThan(0)
  })

  it("rejects platform titles that name a different sibling model", () => {
    expect(
      scoreTiCatalogTitle(
        "2017 - 2021 Mazda CX-5 CX-9 Smart Key 4B Trunk - WAZSKE13D02",
        "TIK-MAZ-99",
        2019,
        "Mazda",
        "CX-3"
      )
    ).toBe(-1)
  })
})

describe("rankTiCatalogRows for 2019 Mazda CX-3", () => {
  const rows: TiSupplierCatalogRow[] = [
    {
      tiSku: "TIK-MAZ-46",
      crossRefTiSku: null,
      title: "2012 - 2018 Mazda 3 5 Door CX-3 CX-5 Smart Key 3B - WAZSKE13D01 WAZSKE13D02",
      fccId: "WAZSKE13D01",
      frequency: "315 MHz",
      buttonCount: 3,
      imageUrl: null,
      productUrl: "https://example.com/maz46",
    },
    {
      tiSku: "TIK-MAZ-46A",
      crossRefTiSku: null,
      title:
        "2012 - 2018 Mazda 3 5 Door CX-3 CX-5 Smart Key 3B - Replaces: WAZSKE13D01 - AFTERMARKET",
      fccId: "",
      frequency: "",
      buttonCount: 3,
      imageUrl: null,
      productUrl: "https://example.com/maz46a",
    },
    {
      tiSku: "TIK-MAZ-66",
      crossRefTiSku: null,
      title: "2019 - 2025 Mazda Smart Key 3B - WAZSKE11D01 BCYN-67-5DY",
      fccId: "WAZSKE11D01",
      frequency: "315 MHz",
      buttonCount: 3,
      imageUrl: null,
      productUrl: "https://example.com/maz66",
    },
    {
      tiSku: "TIK-MAZ-64",
      crossRefTiSku: null,
      title: "2019 - 2025 Mazda Smart Key 4B Trunk - WAZSKE11D01 BCYA-67-5DY",
      fccId: "WAZSKE11D01",
      frequency: "315 MHz",
      buttonCount: 4,
      imageUrl: null,
      productUrl: "https://example.com/maz64",
    },
    {
      tiSku: "TIK-MAZ-65",
      crossRefTiSku: null,
      title: "2019 - 2025 Mazda Smart Key OEM Emergency Blade",
      fccId: "",
      frequency: "",
      buttonCount: 0,
      imageUrl: null,
      productUrl: "https://example.com/maz65",
    },
    {
      tiSku: "TIK-MAZ-56",
      crossRefTiSku: null,
      title: "2016 - 2019 Mazda CX-5 CX-9 Smart Key 4B Trunk - WAZSKE13D02",
      fccId: "WAZSKE13D02",
      frequency: "315 MHz",
      buttonCount: 4,
      imageUrl: null,
      productUrl: "https://example.com/maz56",
    },
  ]

  it("prefers 2019-2025 Mazda platform smart keys over 2012-2018 near-year CX-3 rows", () => {
    const ranked = rankTiCatalogRows(rows, 2019, "Mazda", "CX-3")
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.tiSku).toMatch(/^TIK-MAZ-6[46]$/)
    expect(ranked.map((r) => r.tiSku)).toContain("TIK-MAZ-66")
    expect(ranked.map((r) => r.tiSku)).not.toContain("TIK-MAZ-56")
    expect(ranked.map((r) => r.tiSku)).not.toContain("TIK-MAZ-65")
  })

  it("still surfaces the near-year model-named CX-3 key as a secondary option", () => {
    const ranked = rankTiCatalogRows(rows, 2019, "MAZDA", "CX3")
    expect(ranked.some((r) => r.tiSku.startsWith("TIK-MAZ-46"))).toBe(true)
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
