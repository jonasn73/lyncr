import { describe, expect, it } from "vitest"
import { buildTransponderIslandSku, tiMakeCode } from "@/lib/transponder-island-sku"

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
})
