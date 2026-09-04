import { describe, expect, it } from "vitest"
import {
  EQUIPMENT_AWARE_PROFILES,
  equipmentAwareProfile,
  isEquipmentAwareIndustry,
} from "@/lib/customer-equipment-registry"

describe("customer-equipment-registry (087)", () => {
  it("resolves plumbing/hvac/electrical to their trade-specific kind and label", () => {
    expect(equipmentAwareProfile("plumbing")).toEqual({ kind: "water_heater", label: "Water heater" })
    expect(equipmentAwareProfile("hvac")).toEqual({ kind: "hvac_unit", label: "HVAC unit" })
    expect(equipmentAwareProfile("electrical")).toEqual({
      kind: "electrical_panel",
      label: "Electrical panel",
    })
  })

  it("is null for locksmith, unset, and every other trade", () => {
    expect(equipmentAwareProfile("locksmith")).toBeNull()
    expect(equipmentAwareProfile(null)).toBeNull()
    expect(equipmentAwareProfile(undefined)).toBeNull()
    expect(equipmentAwareProfile("")).toBeNull()
    expect(equipmentAwareProfile("roofing")).toBeNull()
    expect(equipmentAwareProfile("auto_repair")).toBeNull()
  })

  it("isEquipmentAwareIndustry mirrors equipmentAwareProfile", () => {
    for (const industry of Object.keys(EQUIPMENT_AWARE_PROFILES)) {
      expect(isEquipmentAwareIndustry(industry)).toBe(true)
    }
    expect(isEquipmentAwareIndustry("locksmith")).toBe(false)
    expect(isEquipmentAwareIndustry(null)).toBe(false)
  })

  it("is case-insensitive and trims whitespace", () => {
    expect(equipmentAwareProfile(" Plumbing ")).toEqual({ kind: "water_heater", label: "Water heater" })
    expect(equipmentAwareProfile("HVAC")).toEqual({ kind: "hvac_unit", label: "HVAC unit" })
  })
})
