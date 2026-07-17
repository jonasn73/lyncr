import { describe, expect, it } from "vitest"
import {
  buildTransponderIslandSku,
  formatTiSupplierOrderBadge,
  resolveTransponderIslandSupplierSku,
  tiMakeCode,
} from "@/lib/transponder-island-sku"

describe("buildTransponderIslandSku", () => {
  it("builds TI-SKU style catalog codes", () => {
    expect(tiMakeCode("Honda")).toBe("HON")
    expect(
      buildTransponderIslandSku({
        make: "Honda",
        title: "Proximity Smart Key 4 Button",
        keyType: "Smart Key",
        variantId: "abc-104",
      })
    ).toBe("TI-SKU: PROX-HON-04")
  })

  it("maps 2017–2025 Subaru HYQ14AHK prox to TIK-SUB-37A", () => {
    const override = resolveTransponderIslandSupplierSku({
      year: 2021,
      make: "Subaru",
      model: "Outback",
      fccId: "HYQ14AHK",
      catalogSku: "TI-SKU: PROX-SUB-01",
      title: "Proximity Smart Key",
    })
    expect(override).toEqual({
      catalogSku: "PROX-SUB-01",
      supplierSku: "TIK-SUB-37A",
      fccId: "HYQ14AHK",
    })
    expect(formatTiSupplierOrderBadge(override!)).toBe(
      "🛒 Supplier SKU: TIK-SUB-37A (FCC: HYQ14AHK)"
    )
  })

  it("does not override unrelated vehicles", () => {
    expect(
      resolveTransponderIslandSupplierSku({
        year: 2021,
        make: "Honda",
        fccId: "KR5V2X",
        catalogSku: "PROX-HON-04",
      })
    ).toBeNull()
  })
})
