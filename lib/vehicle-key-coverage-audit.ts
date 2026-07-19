// Coverage audit helpers — compare NHTSA picker YMM vs locksmith FCC reference.

import { lookupVehicleKeyProfiles } from "@/lib/vehicle-key-reference"

/** Makes locksmiths see most often (matches nhtsa-vpic priority list). */
export const LOCKSMITH_COVERAGE_MAKES = [
  "FORD",
  "CHEVROLET",
  "TOYOTA",
  "HONDA",
  "NISSAN",
  "JEEP",
  "RAM",
  "GMC",
  "DODGE",
  "HYUNDAI",
  "KIA",
  "SUBARU",
  "MAZDA",
  "VOLKSWAGEN",
  "BMW",
  "MERCEDES-BENZ",
  "LEXUS",
  "ACURA",
  "INFINITI",
  "CHRYSLER",
] as const

/** YMM combos that must always resolve (regression + high-volume jobs). */
export const MUST_RESOLVE_VEHICLE_KEYS: Array<{ year: number; make: string; model: string }> = [
  { year: 2017, make: "Toyota", model: "RAV4" },
  { year: 2017, make: "Toyota", model: "Yaris" },
  { year: 2017, make: "Toyota", model: "Yaris iA" },
  { year: 2021, make: "Toyota", model: "C-HR" },
  { year: 2022, make: "Toyota", model: "Corolla Cross" },
  { year: 2017, make: "CHEVROLET", model: "5500HD" },
  { year: 2014, make: "RAM", model: "1500" },
  { year: 2018, make: "FORD", model: "F-150" },
  { year: 2019, make: "JEEP", model: "Wrangler" },
  { year: 2018, make: "HONDA", model: "Civic" },
  { year: 2018, make: "NISSAN", model: "Altima" },
  { year: 2018, make: "CHEVROLET", model: "Silverado" },
  { year: 2018, make: "GMC", model: "Sierra" },
  { year: 2022, make: "RAM", model: "2500" },
  // European TI-empty backup seed (CSV reference).
  { year: 2018, make: "VOLKSWAGEN", model: "Jetta" },
  { year: 2019, make: "VOLKSWAGEN", model: "Passat" },
  { year: 2015, make: "VOLKSWAGEN", model: "Tiguan" },
  { year: 2016, make: "AUDI", model: "A3" },
  { year: 2010, make: "BMW", model: "3 Series" },
]

/** Known gaps in the open FCC reference — lookup may legitimately return null. */
export const EXPECTED_KEY_LOOKUP_MISSES: Array<{ year: number; make: string; model: string }> = [
  { year: 2020, make: "TESLA", model: "Model 3" },
  // Newer BMW comfort-access years not in the CAS3 seed window.
  { year: 2016, make: "BMW", model: "3 Series" },
]

/** NHTSA model codes that are not real consumer vehicles for locksmith intake. */
const NHTSA_MODEL_NOISE_RE =
  /^\d{2,5}U?$|^\d+$|^\d+\s*Series|^'|police|fchv|motorcycle|^CB[\d-]|^CBR\d|dodgen\s+industries|geo\s+prizm|caprice\s+police|\bCRF\d|\bCota\b|\bElite\s+\d/i

export function isLocksmithRelevantNhtsaModel(model: string): boolean {
  const trimmed = model.trim()
  if (trimmed.length < 2) return false
  if (NHTSA_MODEL_NOISE_RE.test(trimmed)) return false
  if (/^[A-Z]{0,3}\d{3,}[A-Z]?$/i.test(trimmed.replace(/\s+/g, ""))) return false
  return true
}

export type VehicleKeyCoverageCase = {
  year: number
  make: string
  model: string
  expect: "resolve" | "miss_ok"
}

export type VehicleKeyCoverageReport = {
  total: number
  hits: number
  misses: number
  hit_rate: number
  miss_list: string[]
}

export function runVehicleKeyCoverageAudit(cases: VehicleKeyCoverageCase[]): VehicleKeyCoverageReport {
  const miss_list: string[] = []
  let hits = 0
  let total = 0

  for (const c of cases) {
    if (c.expect !== "resolve") continue
    total++
    const result = lookupVehicleKeyProfiles(String(c.year), c.make, c.model)
    if (result?.profiles.length) {
      hits++
    } else {
      miss_list.push(`${c.year} ${c.make} ${c.model}`)
    }
  }

  return {
    total,
    hits,
    misses: total - hits,
    hit_rate: total > 0 ? hits / total : 1,
    miss_list,
  }
}

export function assertMustResolveVehicleKeys(): string[] {
  const failures: string[] = []
  for (const c of MUST_RESOLVE_VEHICLE_KEYS) {
    const result = lookupVehicleKeyProfiles(String(c.year), c.make, c.model)
    if (!result?.profiles.length) {
      failures.push(`${c.year} ${c.make} ${c.model}`)
    }
  }
  return failures
}
