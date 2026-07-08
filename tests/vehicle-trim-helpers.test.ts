import { describe, expect, it } from "vitest"
import { getVehicleTrimHelper, vehicleTrimHelperKey } from "@/lib/vehicle-trim-helpers"

describe("vehicle trim helpers", () => {
  it("builds stable helper keys", () => {
    expect(vehicleTrimHelperKey(2020, "GMC", "Terrain")).toBe("gmc_terrain_2020")
  })

  it("returns GMC Terrain cheatsheet when multiple FCC profiles exist", () => {
    const msg = getVehicleTrimHelper("2020", "GMC", "Terrain", { multipleFcc: true })
    expect(msg).toContain("leather seats")
    expect(msg).toContain("remote start")
  })

  it("hides helper when only one FCC profile is known", () => {
    const msg = getVehicleTrimHelper("2020", "GMC", "Terrain", { multipleFcc: false })
    expect(msg).toBeNull()
  })

  it("shows Honda Civic helper only with conflicting FCC", () => {
    expect(getVehicleTrimHelper("2018", "Honda", "Civic", { multipleFcc: true })).toContain("Push-button")
    expect(getVehicleTrimHelper("2018", "Honda", "Civic", { multipleFcc: false })).toBeNull()
  })
})
