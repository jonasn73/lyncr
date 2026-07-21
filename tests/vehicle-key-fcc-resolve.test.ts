import { describe, expect, it } from "vitest"
import { canonicalFccMatchKey, fccIdsMatch } from "@/lib/fcc-id-input"
import {
  extractButtonCountFromTitle,
  orderTiCatalogByPreferredFcc,
  resolveVehicleKeyFcc,
} from "@/lib/vehicle-key-fcc-resolve"

describe("canonicalFccMatchKey", () => {
  it("treats Ford Conti trailing-00 variants as the same FCC", () => {
    expect(canonicalFccMatchKey("M3N-A2C93142300")).toBe("M3NA2C931423")
    expect(canonicalFccMatchKey("M3NA2C931423")).toBe("M3NA2C931423")
    expect(fccIdsMatch("M3N-A2C931426", "M3NA2C93142600")).toBe(true)
    expect(fccIdsMatch("M3NA2C931423", "M3NA2C931426")).toBe(false)
  })
})

describe("extractButtonCountFromTitle", () => {
  it("reads 3B and 5-Button styles", () => {
    expect(extractButtonCountFromTitle("Mazda Smart Key 3B - WAZSKE11D01")).toBe(3)
    expect(extractButtonCountFromTitle("Equinox Smart Key 5-Button Hatch")).toBe(5)
  })
})

describe("resolveVehicleKeyFcc", () => {
  it("returns a single FCC when only one profile exists", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [{ fccId: "KR5TXN4", frequency: "434", modulation: "FSK", variantCount: 2 }],
      tiHits: [
        {
          fccId: "KR5TXN4",
          tiSku: "TIK-NIS-85A",
          title: "2019 - 2024 Nissan Altima Smart Key 5B - AFTERMARKET",
          buttonCount: 5,
          frequency: "434 MHz",
          score: 160,
        },
      ],
    })
    expect(result.confidence).toBe("high")
    expect(result.resolvedFccId).toBe("KR5TXN4")
    expect(result.needsClarification).toBe(false)
    expect(result.preferredTiSku).toBe("TIK-NIS-85A")
    expect(result.ranked[0]?.reasons).toContain("CSV and TI agree on FCC")
  })

  it("auto-picks from CSV alone when TI has no hits", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [{ fccId: "NBGFS93N", frequency: "315", modulation: "FSK", variantCount: 2 }],
      tiHits: [],
    })
    expect(result.needsClarification).toBe(false)
    expect(result.resolvedFccId).toBe("NBGFS93N")
    expect(result.confidence).toBe("single")
  })

  it("auto-picks from TI alone when CSV has no profiles", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [],
      tiHits: [
        {
          fccId: "KR5TXN4",
          tiSku: "TIK-NIS-85A",
          title: "2019 - 2024 Nissan Altima Smart Key 5B - AFTERMARKET",
          buttonCount: 5,
          frequency: "434 MHz",
          score: 160,
        },
      ],
    })
    expect(result.needsClarification).toBe(false)
    expect(result.resolvedFccId).toBe("KR5TXN4")
    expect(result.confidence).toBe("single")
  })

  it("asks when CSV and TI list different FCC IDs", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [{ fccId: "NBGFS93N", frequency: "315", modulation: "FSK", variantCount: 1 }],
      tiHits: [
        {
          fccId: "WRONGFCC1",
          tiSku: "TIK-VW-99A",
          title: "2018 Volkswagen Jetta Smart Key - AFTERMARKET",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 200,
        },
      ],
    })
    expect(result.needsClarification).toBe(true)
    expect(result.resolvedFccId).toBeNull()
    expect(result.clarification?.id).toBe("fcc-source-conflict")
    expect(result.clarification?.options.map((o) => o.fccId).sort()).toEqual([
      "NBGFS93N",
      "WRONGFCC1",
    ])
  })

  it("auto-picks the FCC that aftermarket TI blanks agree on", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [
        { fccId: "WAZSKE13D01", frequency: "315", modulation: "FSK", variantCount: 1 },
        { fccId: "WAZSKE11D01", frequency: "315", modulation: "FSK", variantCount: 1 },
      ],
      tiHits: [
        {
          fccId: "WAZSKE13D01",
          tiSku: "TIK-MAZ-46A",
          title: "2012 - 2018 Mazda CX-3 Smart Key 3B - AFTERMARKET",
          buttonCount: 3,
          frequency: "315 MHz",
          score: 140,
        },
        {
          fccId: "WAZSKE11D01",
          tiSku: "TIK-MAZ-66",
          title: "2019 - 2025 Mazda Smart Key 3B",
          buttonCount: 3,
          frequency: "315 MHz",
          score: 150,
        },
      ],
    })
    expect(result.needsClarification).toBe(false)
    expect(result.resolvedFccId).toBe("WAZSKE13D01")
    expect(result.preferredTiSku).toBe("TIK-MAZ-46A")
  })

  it("asks button-count when two FCCs remain with different button layouts", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [
        { fccId: "AAA111", frequency: "315", modulation: "FSK", variantCount: 1 },
        { fccId: "BBB222", frequency: "315", modulation: "FSK", variantCount: 1 },
      ],
      tiHits: [
        {
          fccId: "AAA111",
          tiSku: "TIK-TEST-01",
          title: "Test Smart Key 3B",
          buttonCount: 3,
          frequency: "315 MHz",
          score: 100,
        },
        {
          fccId: "BBB222",
          tiSku: "TIK-TEST-02",
          title: "Test Smart Key 4B Trunk",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 100,
        },
      ],
    })
    expect(result.needsClarification).toBe(true)
    expect(result.resolvedFccId).toBeNull()
    expect(result.clarification?.id).toBe("fcc-button-count")
    expect(result.clarification?.options.map((o) => o.fccId).sort()).toEqual(["AAA111", "BBB222"])
  })

  it("auto-picks when FCC variants share the same key profile (HO03-style)", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [
        { fccId: "HO03", frequency: "313.85", modulation: "ASK", variantCount: 2 },
        { fccId: "HO03PT", frequency: "313.85", modulation: "ASK", variantCount: 2 },
      ],
      tiHits: [
        {
          fccId: "HO03",
          tiSku: "TIK-HON-01A",
          title: "2003 - 2007 Honda Accord Remote Head Key 3B - AFTERMARKET",
          buttonCount: 3,
          frequency: "313.85 MHz",
          score: 140,
        },
        {
          fccId: "HO03PT",
          tiSku: "TIK-HON-01A",
          title: "2003 - 2007 Honda Accord Remote Head Key 3B - AFTERMARKET",
          buttonCount: 3,
          frequency: "313.85 MHz",
          score: 130,
        },
      ],
    })
    expect(result.needsClarification).toBe(false)
    expect(result.resolvedFccId).toBeTruthy()
    expect(["HO03", "HO03PT"]).toContain(result.resolvedFccId)
    expect(result.preferredTiSku).toBe("TIK-HON-01A")
  })

  it("asks push vs turn-key when FSK and ASK profiles both score closely", () => {
    const result = resolveVehicleKeyFcc({
      profiles: [
        { fccId: "SMART1", frequency: "434", modulation: "FSK", variantCount: 1 },
        { fccId: "TURN1", frequency: "315", modulation: "ASK", variantCount: 1 },
      ],
      tiHits: [],
    })
    expect(result.needsClarification).toBe(true)
    expect(result.clarification?.id).toBe("multiple-fcc-ignition")
    expect(result.clarification?.options[0]?.fccId).toBe("SMART1")
    expect(result.clarification?.options[1]?.fccId).toBe("TURN1")
  })

  it("does not auto-pick smart when ASK + FSK exist even if smart TI scores higher", () => {
    // Mirrors 2018 Nissan Sentra: smart aftermarket outscores remote-head, but both are valid.
    const result = resolveVehicleKeyFcc({
      profiles: [
        { fccId: "CWTWB1U751", frequency: "315", modulation: "ASK", variantCount: 2 },
        { fccId: "CWTWB1U840", frequency: "315", modulation: "FSK", variantCount: 2 },
      ],
      tiHits: [
        {
          fccId: "CWTWB1U840",
          tiSku: "TIK-NIS-52A",
          title: "2013 - 2019 Nissan Sentra Versa Smart Prox Key - AFTERMARKET",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 220,
        },
        {
          fccId: "CWTWB1U751",
          tiSku: "TIK-NIS-17A",
          title: "2013 - 2019 Nissan Remote Head Key 4B Trunk - AFTERMARKET",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 160,
        },
      ],
    })
    expect(result.needsClarification).toBe(true)
    expect(result.resolvedFccId).toBeNull()
    expect(result.clarification?.id).toBe("multiple-fcc-ignition")
  })

  it("asks push vs turn for 2018 F-150 when TI omits trailing 00 and buries flip-key FCC", () => {
    // Production bug: TI lists M3N-A2C931423 (no 00); CSV has M3NA2C93142300 + N5FA08TAA.
    // Without canonical match, source-conflict showed only TI smart keys.
    const result = resolveVehicleKeyFcc({
      profiles: [
        { fccId: "M3NA2C93142300", frequency: "314.95", modulation: "FSK", variantCount: 2 },
        { fccId: "M3NA2C93142600", frequency: "902.375/903.425", modulation: "FSK", variantCount: 2 },
        { fccId: "N5FA08TAA", frequency: "314.95", modulation: "ASK", variantCount: 3 },
        { fccId: "N5FA08TDA", frequency: "902.375/903.425", modulation: "FSK", variantCount: 1 },
      ],
      tiHits: [
        {
          fccId: "M3NA2C931426",
          tiSku: "TIK-FOR-101A",
          title: "2018 - 2026 Ford Lincoln Smart Key 5B Hatch / Starter - AFTERMARKET",
          buttonCount: 5,
          frequency: "902 MHz",
          score: 200,
        },
        {
          fccId: "M3NA2C931423",
          tiSku: "TIK-FOR-108A",
          title: "2018 - 2026 Ford Smart Key 4B Hatch - AFTERMARKET",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 190,
        },
        {
          fccId: "M3N5WY8609",
          tiSku: "TIK-FOR-32A",
          title: "2011 - 2019 Ford Smart Key W/O Hatchback - AFTERMARKET",
          buttonCount: 4,
          frequency: "315 MHz",
          score: 120,
        },
        {
          fccId: "M3NA2C31243300",
          tiSku: "TIK-FOR-66A",
          title: "2015 - 2017 Ford F-150 2 Way Smart Key 5B - AFTERMARKET",
          buttonCount: 5,
          frequency: "902 MHz",
          score: 110,
        },
      ],
    })
    expect(result.needsClarification).toBe(true)
    expect(result.clarification?.id).toBe("multiple-fcc-ignition")
    const turn = result.clarification?.options.find((o) => o.id === "multi-fcc-turn-key")
    expect(turn?.fccId).toBe("N5FA08TAA")
    expect(turn?.keyStyle).toMatch(/remote head|turn/i)
    // Merged TI+CSV smart ID should prefer the longer CSV display form.
    const push = result.clarification?.options.find((o) => o.id === "multi-fcc-push")
    expect(push?.fccId).toMatch(/^M3NA2C93142/)
  })
})

describe("orderTiCatalogByPreferredFcc", () => {
  const hits = [
    { fccId: "BBB222", tiSku: "TIK-B", title: "B", score: 1 },
    { fccId: "AAA111", tiSku: "TIK-A", title: "A", score: 1 },
  ]

  it("moves the preferred FCC to the front", () => {
    const ordered = orderTiCatalogByPreferredFcc(hits, "AAA111", false)
    expect(ordered[0]!.fccId).toBe("AAA111")
    expect(ordered).toHaveLength(2)
  })

  it("strict mode keeps only the preferred FCC", () => {
    const ordered = orderTiCatalogByPreferredFcc(hits, "AAA111", true)
    expect(ordered.map((h) => h.fccId)).toEqual(["AAA111"])
  })

  it("matches preferred FCC when TI omits trailing 00", () => {
    const fordHits = [
      { fccId: "M3NA2C931423", tiSku: "TIK-A", title: "Smart", score: 1 },
      { fccId: "OTHER", tiSku: "TIK-B", title: "Other", score: 1 },
    ]
    const ordered = orderTiCatalogByPreferredFcc(fordHits, "M3NA2C93142300", true)
    expect(ordered.map((h) => h.fccId)).toEqual(["M3NA2C931423"])
  })
})
