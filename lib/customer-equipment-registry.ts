// ============================================
// "Equipment on file" — industry-aware customer equipment (087)
// ============================================
// Generalizes the existing "vehicle on file" pattern (customer_vehicles — locksmith,
// auto_repair, towing) for the three trades with the deepest AI-script investment among
// the non-locksmith trades: plumbing, HVAC, electrical. A repeat customer's water
// heater / HVAC unit / breaker panel shows up on file instead of a tech starting blank.
//
// Deliberately not folded into VEHICLE_AWARE_PROFILES / customer_vehicles — that table's
// vin/fcc_id columns are locksmith/auto concepts with no equivalent here, and mixing the
// two risks the locksmith vehicle flow, the app's original and most revenue-critical path.

export type EquipmentAwareProfile = {
  /** Stored in customer_equipment.kind. */
  kind: string
  /** Shown in the CRM panel header and manual-intake section, e.g. "Water heater". */
  label: string
}

export const EQUIPMENT_AWARE_PROFILES: Record<string, EquipmentAwareProfile> = {
  plumbing: { kind: "water_heater", label: "Water heater" },
  hvac: { kind: "hvac_unit", label: "HVAC unit" },
  electrical: { kind: "electrical_panel", label: "Electrical panel" },
  garage_door: { kind: "garage_door_opener", label: "Garage door opener" },
  appliance_repair: { kind: "appliance", label: "Appliance" },
  pool_service: { kind: "pool_equipment", label: "Pool equipment" },
  security_systems: { kind: "security_system", label: "Alarm / camera system" },
  solar: { kind: "solar_system", label: "Solar system" },
}

export function equipmentAwareProfile(
  industry: string | null | undefined
): EquipmentAwareProfile | null {
  const id = (industry || "").trim().toLowerCase()
  return EQUIPMENT_AWARE_PROFILES[id] ?? null
}

export function isEquipmentAwareIndustry(industry: string | null | undefined): boolean {
  return equipmentAwareProfile(industry) != null
}
