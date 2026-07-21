import { describe, expect, it } from "vitest"
import {
  filterTiCatalogForClarification,
  scoreTiCatalogTitle,
  tiHitMatchesKeyStyle,
} from "@/lib/ti-supplier-catalog-shared"

describe("tiHitMatchesKeyStyle", () => {
  it("separates smart vs remote-head titles", () => {
    expect(
      tiHitMatchesKeyStyle(
        { title: "2013 - 2019 Nissan Sentra Smart Prox Key - 4B" },
        "Push start (smart key)"
      )
    ).toBe(true)
    expect(
      tiHitMatchesKeyStyle(
        { title: "2013 - 2019 Nissan Sentra Smart Prox Key - 4B" },
        "Remote head key"
      )
    ).toBe(false)
    expect(
      tiHitMatchesKeyStyle(
        { title: "2013 - 2019 Nissan Remote Head Key 4B Trunk - CWTWB1U751" },
        "Remote head key"
      )
    ).toBe(true)
  })
})

describe("filterTiCatalogForClarification", () => {
  const hits = [
    {
      tiSku: "TIK-NIS-52A",
      fccId: "CWTWB1U840",
      title: "2013 - 2019 Nissan Sentra Versa Smart Prox Key - AFTERMARKET",
      score: 200,
    },
    {
      tiSku: "TIK-NIS-17A",
      fccId: "CWTWB1U751",
      title: "2013 - 2019 Nissan Remote Head Key 4B Trunk - AFTERMARKET",
      score: 180,
    },
    {
      tiSku: "TIK-NIS-32A",
      fccId: "KR55WK49622",
      title: "2009 - 2020 Nissan GT-R Smart Prox Key - AFTERMARKET",
      score: 190,
    },
  ]

  it("filters to turn-key FCC blanks", () => {
    const filtered = filterTiCatalogForClarification(hits, "CWTWB1U751", "Remote head key")
    expect(filtered.map((h) => h.tiSku)).toEqual(["TIK-NIS-17A"])
  })

  it("filters by style when FCC is missing from catalog rows", () => {
    const filtered = filterTiCatalogForClarification(hits, "UNKNOWNFCC", "Remote head key")
    expect(filtered.map((h) => h.tiSku)).toEqual(["TIK-NIS-17A"])
  })

  it("returns empty instead of keeping a wrong smart blank", () => {
    const onlySmart = hits.filter((h) => h.tiSku !== "TIK-NIS-17A")
    expect(filterTiCatalogForClarification(onlySmart, null, "Remote head key")).toEqual([])
  })

  it("drops FCC-matched smart blanks when style is turn-key", () => {
    const filtered = filterTiCatalogForClarification(hits, "CWTWB1U840", "Remote head key")
    expect(filtered.map((h) => h.tiSku)).toEqual(["TIK-NIS-17A"])
  })
})

describe("GT-R does not platform-match Sentra", () => {
  it("rejects GT-R smart key for a Sentra request", () => {
    expect(
      scoreTiCatalogTitle(
        "2009 - 2020 Nissan GT-R Smart Prox Key - 4B Trunk KR55WK49622",
        "TIK-NIS-32A",
        2018,
        "Nissan",
        "Sentra"
      )
    ).toBe(-1)
  })
})
