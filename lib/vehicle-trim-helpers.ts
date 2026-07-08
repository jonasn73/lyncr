// Dispatcher cheatsheet prompts for vehicles where trim / factory options change the correct key FCC.

import type { VehicleFactoryOption } from "@/lib/vehicle-trim-features"

export type VehicleTrimHelperRule = {
  /** Stable id (e.g. GMC_Terrain_2020). */
  id: string
  makes: string[]
  /** Model name or substring match (case-insensitive). */
  models: string[]
  yearMin?: number
  yearMax?: number
  /** When true, only show if multiple FCC profiles were returned for this YMM. */
  requiresConflictingFcc?: boolean
  message: string
  /** Optional factory options to attach when plate/VIN confirms upscale trim. */
  upscaleFactoryOptions?: VehicleFactoryOption[]
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function ruleMatches(
  rule: VehicleTrimHelperRule,
  year: number,
  make: string,
  model: string
): boolean {
  const makeKey = normalizeToken(make)
  if (!rule.makes.map(normalizeToken).includes(makeKey)) return false
  const modelKey = normalizeToken(model)
  const modelMatch = rule.models.some((candidate) => {
    const key = normalizeToken(candidate)
    return modelKey === key || modelKey.includes(key) || key.includes(modelKey)
  })
  if (!modelMatch) return false
  if (rule.yearMin != null && year < rule.yearMin) return false
  if (rule.yearMax != null && year > rule.yearMax) return false
  return true
}

/** Curated dispatcher scripts — expand over time or move to DB later. */
export const VEHICLE_TRIM_HELPER_RULES: VehicleTrimHelperRule[] = [
  {
    id: "GMC_Terrain_2020",
    makes: ["GMC"],
    models: ["Terrain"],
    yearMin: 2018,
    yearMax: 2021,
    message:
      "Ask caller: Do they have leather seats or a dual exhaust? If yes, it is likely an SLT/Denali with factory remote start.",
    upscaleFactoryOptions: ["remote_start"],
  },
  {
    id: "Chevrolet_Equinox_2020",
    makes: ["Chevrolet"],
    models: ["Equinox"],
    yearMin: 2018,
    yearMax: 2022,
    message:
      "Ask caller: Power liftgate or hands-free hatch? Leather-appointed seats? Premier/RS trims usually have remote start.",
    upscaleFactoryOptions: ["remote_start", "power_liftgate"],
  },
  {
    id: "Ford_Explorer_2020",
    makes: ["Ford"],
    models: ["Explorer"],
    yearMin: 2016,
    yearMax: 2023,
    message:
      "Ask caller: Push-button start on the dash? Power liftgate? Limited/ST trims carry smart keys with remote start.",
    upscaleFactoryOptions: ["remote_start", "proximity_entry", "push_button_start"],
  },
  {
    id: "Toyota_RAV4_2019",
    makes: ["Toyota"],
    models: ["RAV4"],
    yearMin: 2016,
    yearMax: 2022,
    message:
      "Ask caller: Power tailgate or smart key / push-button start? XLE Premium and Adventure trims often have factory remote start.",
    upscaleFactoryOptions: ["remote_start", "power_liftgate"],
  },
  {
    id: "Honda_Civic_2018",
    makes: ["Honda"],
    models: ["Civic"],
    yearMin: 2016,
    yearMax: 2021,
    message:
      "Ask caller: Push-button start or turn-key ignition? Touring/EX-L with push start use a different FCC than LX turn-key.",
    requiresConflictingFcc: true,
  },
]

/** Build lookup key used in configs and logs. */
export function vehicleTrimHelperKey(year: number, make: string, model: string): string {
  return `${normalizeToken(make)}_${normalizeToken(model)}_${year}`
}

/** Return dispatcher trim cheatsheet when YMM (and optional multi-FCC) matches a rule. */
export function getVehicleTrimHelper(
  yearRaw: string | number,
  makeRaw: string,
  modelRaw: string,
  opts?: { multipleFcc?: boolean }
): string | null {
  const year = typeof yearRaw === "number" ? yearRaw : Number(String(yearRaw).trim())
  const make = makeRaw.trim()
  const model = modelRaw.trim()
  if (!Number.isFinite(year) || year < 1980 || !make || !model) return null

  const multipleFcc = opts?.multipleFcc === true
  for (const rule of VEHICLE_TRIM_HELPER_RULES) {
    if (!ruleMatches(rule, year, make, model)) continue
    const needsConflict = rule.requiresConflictingFcc !== false
    if (needsConflict && !multipleFcc) continue
    return rule.message
  }
  return null
}

/** Find the matching rule object (e.g. to apply factory options after plate decode). */
export function findVehicleTrimHelperRule(
  yearRaw: string | number,
  makeRaw: string,
  modelRaw: string
): VehicleTrimHelperRule | null {
  const year = typeof yearRaw === "number" ? yearRaw : Number(String(yearRaw).trim())
  const make = makeRaw.trim()
  const model = modelRaw.trim()
  if (!Number.isFinite(year) || year < 1980 || !make || !model) return null
  return VEHICLE_TRIM_HELPER_RULES.find((rule) => ruleMatches(rule, year, make, model)) ?? null
}
