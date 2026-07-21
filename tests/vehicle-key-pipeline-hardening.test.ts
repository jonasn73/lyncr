import { describe, expect, it } from "vitest"
import {
  filterManualOptionsByKeyStyle,
  modulationMatchesKeyStyle,
  wantsTurnKeyStyle,
} from "@/lib/fcc-id-input"
import {
  ensureTiCatalogStyleDiversity,
  filterTiCatalogForClarification,
  rankTiCatalogRows,
  type TiSupplierCatalogRow,
} from "@/lib/ti-supplier-catalog-shared"
import { resolveVehicleKeyFcc } from "@/lib/vehicle-key-fcc-resolve"

describe("pipeline hardening — style gates", () => {
  it("does not keep a smart blank when FCC matches but style is turn-key", () => {
    const hits = [
      {
        tiSku: "TIK-FOR-108A",
        fccId: "M3NA2C931423",
        title: "2018 Ford Smart Key 4B - AFTERMARKET",
        score: 200,
      },
      {
        tiSku: "TIK-FOR-70A",
        fccId: "N5FA08TAA",
        title: "2015 - 2026 Ford High Security Remote Head Flip Key - AFTERMARKET",
        score: 150,
      },
    ]
    const filtered = filterTiCatalogForClarification(
      hits,
      "M3NA2C93142300",
      "Remote head key"
    )
    expect(filtered.map((h) => h.tiSku)).toEqual(["TIK-FOR-70A"])
  })

  it("auto-picks turn-key FCC after preferredKeyStyle is pinned", () => {
    const result = resolveVehicleKeyFcc({
      preferredKeyStyle: "Remote head key",
      profiles: [
        { fccId: "M3NA2C93142300", frequency: "314.95", modulation: "FSK", variantCount: 2 },
        { fccId: "N5FA08TAA", frequency: "314.95", modulation: "ASK", variantCount: 3 },
      ],
      tiHits: [
        {
          fccId: "M3NA2C931423",
          tiSku: "TIK-FOR-108A",
          title: "2018 Ford Smart Key - AFTERMARKET",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 200,
        },
        {
          fccId: "N5FA08TAA",
          tiSku: "TIK-FOR-70A",
          title: "2015 - 2026 Ford High Security Remote Head Flip Key - AFTERMARKET",
          buttonCount: 3,
          frequency: "315 MHz",
          score: 140,
        },
      ],
    })
    expect(result.needsClarification).toBe(false)
    expect(result.resolvedFccId).toBe("N5FA08TAA")
    expect(wantsTurnKeyStyle("Remote head key")).toBe(true)
  })

  it("keeps a flip-key blank in the top TI list when smart titles dominate", () => {
    const rows: TiSupplierCatalogRow[] = [
      {
        tiSku: "TIK-FOR-101A",
        crossRefTiSku: null,
        title: "2018 - 2026 Ford F-150 Smart Key 5B - AFTERMARKET",
        fccId: "M3NA2C931426",
        frequency: "902 MHz",
        buttonCount: 5,
        imageUrl: null,
        productUrl: "https://example.com/smart",
      },
      {
        tiSku: "TIK-FOR-108A",
        crossRefTiSku: null,
        title: "2018 - 2026 Ford F-150 Smart Key 4B - AFTERMARKET",
        fccId: "M3NA2C931423",
        frequency: "315 MHz",
        buttonCount: 4,
        imageUrl: null,
        productUrl: "https://example.com/smart2",
      },
      {
        tiSku: "TIK-FOR-70A",
        crossRefTiSku: null,
        title: "2015 - 2026 Ford High Security Remote Head Flip Key - AFTERMARKET",
        fccId: "N5FA08TAA",
        frequency: "315 MHz",
        buttonCount: 3,
        imageUrl: null,
        productUrl: "https://example.com/flip",
      },
    ]
    const ranked = rankTiCatalogRows(rows, 2018, "Ford", "F-150", 2)
    expect(ranked.some((r) => /flip|remote head/i.test(r.title))).toBe(true)
  })

  it("ensureTiCatalogStyleDiversity injects a turn-key row", () => {
    const diversified = ensureTiCatalogStyleDiversity(
      [
        { tiSku: "S1", title: "Ford Smart Key", score: 200 },
        { tiSku: "S2", title: "Ford Smart Prox", score: 190 },
        { tiSku: "T1", title: "Ford Remote Head Flip Key", score: 100 },
      ],
      2
    )
    expect(diversified).toHaveLength(2)
    expect(diversified.some((r) => /flip|remote head/i.test(r.title))).toBe(true)
  })

  it("filters ASK vs FSK profiles by pinned key style", () => {
    expect(modulationMatchesKeyStyle("ASK", "Remote head key")).toBe(true)
    expect(modulationMatchesKeyStyle("FSK", "Remote head key")).toBe(false)
    expect(modulationMatchesKeyStyle("FSK", "Push start (smart key)")).toBe(true)
  })

  it("filters manual mock cards by turn-key style", () => {
    const options = filterManualOptionsByKeyStyle(
      [
        {
          id: "a",
          label: "Smart",
          keyStyle: "Push start (smart key)",
          frequency: "315",
          description: "",
          programmingMethod: "",
          imageUrl: null,
        },
        {
          id: "b",
          label: "Flip",
          keyStyle: "Remote head key",
          frequency: "315",
          description: "",
          programmingMethod: "",
          imageUrl: null,
        },
      ],
      "Turn-key / remote head"
    )
    expect(options.map((o) => o.id)).toEqual(["b"])
  })
})
