import { describe, expect, it } from "vitest"
import {
  lookupMykeysProProfile,
  mykeysProKeyOptions,
  mykeysProVehicleKey,
} from "@/lib/mykeys-pro-database"

describe("mykeys-pro-database", () => {
  it("builds vehicle lookup keys from make and model", () => {
    expect(mykeysProVehicleKey("Mazda", "CX-90")).toBe("Mazda CX-90")
  })

  it("returns Mazda CX-90 MKP profile with two key rows", () => {
    const profile = lookupMykeysProProfile("Mazda", "CX-90")
    expect(profile?.fccId).toBe("WAX12DH45")
    expect(profile?.keys).toHaveLength(2)
    expect(profile?.keys[0]?.method).toBe("OBD2 Bypass (3-Min Delay)")
    expect(profile?.keys[0]?.img).toContain("mazda-cx90.png")
  })

  it("maps vehicle-specific MKP rows into intake cards", () => {
    const options = mykeysProKeyOptions("Subaru", "Outback")
    expect(options).toHaveLength(1)
    expect(options[0]?.label).toBe("Proximity Smart Key")
    expect(options[0]?.programmingMethod).toBe("Active Dashboard Turn Sequence")
    expect(options[0]?.imageUrl).toContain("subaru-prox.png")
    expect(options[0]?.fccId).toBe("HYQ14AHK")
  })

  it("falls back to generic manual options for unknown vehicles", () => {
    const options = mykeysProKeyOptions("Toyota", "Camry")
    expect(options).toHaveLength(3)
    expect(options[0]?.id).toBe("manual-315-transponder")
  })
})
