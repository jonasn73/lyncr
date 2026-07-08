import { describe, expect, it } from "vitest"
import { lookupVehicleByPlate } from "@/lib/vehicle-plate-lookup"

describe("vehicle plate lookup", () => {
  it("resolves demo Kentucky GMC Terrain plate", async () => {
    const result = await lookupVehicleByPlate("ABC2020", "KY")
    expect(result.vehicle_year).toBe("2020")
    expect(result.vehicle_make).toBe("GMC")
    expect(result.vehicle_model).toBe("Terrain")
    expect(result.trim).toBe("SLT")
    expect(result.vin).toMatch(/^3GK/)
    expect(result.factory_options).toContain("remote_start")
  })

  it("returns a helpful error for unknown plates", async () => {
    const result = await lookupVehicleByPlate("ZZZZ999", "KY")
    expect(result.vehicle_make).toBeNull()
    expect(result.error).toContain("No registration match")
  })

  it("rejects empty plate input", async () => {
    const result = await lookupVehicleByPlate("", "KY")
    expect(result.error).toContain("valid license plate")
  })
})
