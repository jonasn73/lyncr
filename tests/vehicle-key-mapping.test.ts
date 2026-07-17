import { describe, expect, it } from "vitest"
import { MANUAL_KEY_FREQUENCY_OPTIONS } from "@/lib/fcc-id-input"
import { buildTransponderIslandSku } from "@/lib/transponder-island-sku"
import {
  applyVehicleKeyCardOverrides,
  filterFccVariantsForVehicle,
  filterManualOptionsForVehicle,
  isSubaru2017To2025ProxMap,
  SUBARU_2017_2025_PROX,
  subaruMappedProxOption,
} from "@/lib/vehicle-key-mapping"

describe("vehicle-key-mapping", () => {
  it("detects 2017–2025 Subaru map years", () => {
    expect(isSubaru2017To2025ProxMap(2022, "Subaru")).toBe(true)
    expect(isSubaru2017To2025ProxMap("2017", "subaru")).toBe(true)
    expect(isSubaru2017To2025ProxMap(2016, "Subaru")).toBe(false)
    expect(isSubaru2017To2025ProxMap(2022, "Honda")).toBe(false)
  })

  it("forces a single PROX-SUB-01 / TIK-SUB-37A manual card for mapped Subaru", () => {
    const options = filterManualOptionsForVehicle(
      [...MANUAL_KEY_FREQUENCY_OPTIONS],
      2022,
      "Subaru"
    )
    expect(options).toHaveLength(1)
    expect(options[0]?.catalogSku).toBe("PROX-SUB-01")
    expect(options[0]?.supplierSku).toBe("TIK-SUB-37A")
    expect(options[0]?.description).toBe(SUBARU_2017_2025_PROX.specText)
  })

  it("hides KEY-SUB-15 / KEY-SUB-01 and keeps only PROX-SUB-01 for mapped Subaru", () => {
    const variants = [
      { id: "sub-key-15", title: "OBD Programmer Kit", key_type: "Tool" },
      { id: "sub-key-01", title: "DIY Kit", key_type: "Tool" },
      { id: "sub-prox-01", title: "Proximity Smart Key 4 Button", key_type: "Smart Key" },
    ]
    expect(
      buildTransponderIslandSku({
        make: "Subaru",
        title: variants[0]!.title,
        keyType: variants[0]!.key_type,
        variantId: variants[0]!.id,
      })
    ).toBe("TI-SKU: KEY-SUB-15")
    expect(
      buildTransponderIslandSku({
        make: "Subaru",
        title: variants[1]!.title,
        keyType: variants[1]!.key_type,
        variantId: variants[1]!.id,
      })
    ).toBe("TI-SKU: KEY-SUB-01")
    expect(
      buildTransponderIslandSku({
        make: "Subaru",
        title: variants[2]!.title,
        keyType: variants[2]!.key_type,
        variantId: variants[2]!.id,
      })
    ).toBe("TI-SKU: PROX-SUB-01")

    const filtered = filterFccVariantsForVehicle(variants, 2021, "Subaru")
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe("sub-prox-01")
  })

  it("overrides PROX-SUB-01 card to TI-SKU: TIK-SUB-37A with mapped Spec text", () => {
    const mapped = subaruMappedProxOption()
    const card = applyVehicleKeyCardOverrides(
      {
        id: mapped.id,
        tiSku: "TI-SKU: PROX-SUB-01",
        specs: [{ label: "Spec", value: "old" }],
        supplierOrderBadge: "🛒 Supplier SKU: TIK-SUB-37A (FCC: HYQ14AHK)",
        fccFootnote: "FCC HYQ14AHK",
      },
      2022,
      "Subaru"
    )
    expect(card.tiSku).toBe("TI-SKU: TIK-SUB-37A")
    expect(card.specs?.[0]?.value).toBe(SUBARU_2017_2025_PROX.specText)
    expect(card.supplierOrderBadge).toBeNull()
  })
})
