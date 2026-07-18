import { describe, expect, it } from "vitest"
import { deriveCallTimeInventorySku } from "@/lib/call-time-inventory-sku"

describe("deriveCallTimeInventorySku", () => {
  it("prefers the selected TI blank over FCC- invent", () => {
    expect(
      deriveCallTimeInventorySku({
        selectedFccId: "WAZSKE13D01",
        selectedTiSku: "TIK-MAZ-46A",
        year: "2018",
        make: "Mazda",
        model: "CX-3",
      })
    ).toBe("TIK-MAZ-46A")
  })

  it("falls back to FCC- only when no TI blank is selected", () => {
    expect(
      deriveCallTimeInventorySku({
        selectedFccId: "WAZSKE13D01",
        year: "2018",
        make: "Mazda",
        model: "CX-3",
      })
    ).toBe("FCC-WAZSKE13D01")
  })
})
