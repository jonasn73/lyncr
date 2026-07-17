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
    expect(profile?.keys[0]?.img).toBe("/key-images/mykeys/mazda-cx90-prox.svg")
  })

  it("maps vehicle-specific MKP rows into intake cards", () => {
    const options = mykeysProKeyOptions("Subaru", "Outback")
    expect(options).toHaveLength(1)
    expect(options[0]?.label).toBe("Proximity Smart Key")
    expect(options[0]?.programmingMethod).toBe("Active Dashboard Turn Sequence")
    expect(options[0]?.imageUrl).toBe("/key-images/mykeys/subaru-prox.svg")
    expect(options[0]?.fccId).toBe("HYQ14AHK")
    expect(options[0]?.catalogSku).toBe("PROX-SUB-01")
    expect(options[0]?.supplierSku).toBe("TIK-SUB-37A")
  })

  it("forces TIK-SUB-37A for any 2017–2025 Subaru model (e.g. Forester)", () => {
    const options = mykeysProKeyOptions("Subaru", "Forester", 2022)
    expect(options).toHaveLength(1)
    expect(options[0]?.catalogSku).toBe("PROX-SUB-01")
    expect(options[0]?.supplierSku).toBe("TIK-SUB-37A")
    expect(options[0]?.fccId).toBe("HYQ14AHK")
  })

  it("falls back to generic manual options for unknown vehicles", () => {
    const options = mykeysProKeyOptions("Toyota", "Camry")
    expect(options).toHaveLength(3)
    expect(options[0]?.id).toBe("manual-315-transponder")
  })

  it("prepends KEY-VOL-05 prox and insert-to-start variants for classic Volvo models", () => {
    const options = mykeysProKeyOptions("Volvo", "C30")
    expect(options[0]?.id).toBe("KEY-VOL-05-PROX")
    expect(options[0]?.label).toBe("Volvo 5-Button Smart Proximity Key")
    expect(options[0]?.fccId).toBe("KR55WK49250")
    expect(options[0]?.supplierSku).toBe("TIK-VOL-13N")
    expect(options[1]?.id).toBe("KEY-VOL-05-NONPROX")
    expect(options[1]?.label).toBe("Volvo 5-Button Insert-to-Start Key")
    expect(options[1]?.fccId).toBe("KR55WK49259")
    expect(options[1]?.supplierSku).toBe("TIK-VOL-19N")
    expect(options).toHaveLength(5)
  })
})
