// NHTSA vPIC vehicle catalog helpers (free, no API key).
// Used by owner scheduler + receptionist intake for Year → Make → Model.

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles"

/** Passenger/light-duty types only — excludes trailers, motorcycles, etc. */
const PASSENGER_VEHICLE_TYPES = ["car", "truck", "multipurpose passenger vehicle (mpv)"] as const

/** US field-service shops see these makes most often — shown first in dropdowns. */
const PRIORITY_MAKE_ORDER = [
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
  "VOLKSWAGEN",
  "BMW",
  "MERCEDES-BENZ",
  "AUDI",
  "LEXUS",
  "MAZDA",
  "TESLA",
  "BUICK",
  "CADILLAC",
  "LINCOLN",
  "CHRYSLER",
  "VOLVO",
  "MITSUBISHI",
  "LAND ROVER",
  "JAGUAR",
  "PORSCHE",
  "MINI",
  "GENESIS",
  "INFINITI",
  "ACURA",
  "RIVIAN",
]

let makesCache: { at: number; makes: string[] } | null = null
const MODELS_CACHE = new Map<string, { at: number; models: string[] }>()
const CACHE_MS = 1000 * 60 * 60 * 12

/** NHTSA sometimes lists trailer/fabrication businesses under major make names — drop those. */
const MODEL_JUNK_RE =
  /\btrailer\b|trailers|\bllc\b|\binc\.?\b|\bmfg\b|manufactur|fabricat|\btanks\b|pipe\s*&|\bsupply\b|\bsteel\b|radiator|\bsales\b|motorhome|commercial chassis|travel park|aluminum|\bbuilt\b|\bsedan$|#\d/i

export function vehicleYearOptions(): number[] {
  const now = new Date().getFullYear() + 1
  const years: number[] = []
  for (let y = now; y >= 1985; y -= 1) years.push(y)
  return years
}

function uniqueSorted(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function isConsumerVehicleModel(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return !MODEL_JUNK_RE.test(trimmed)
}

function sortMakesForFieldService(makes: string[]): string[] {
  const rank = new Map(PRIORITY_MAKE_ORDER.map((make, index) => [make.toUpperCase(), index]))
  return [...makes].sort((a, b) => {
    const aRank = rank.get(a.toUpperCase()) ?? 9999
    const bRank = rank.get(b.toUpperCase()) ?? 9999
    if (aRank !== bRank) return aRank - bRank
    return a.localeCompare(b)
  })
}

async function fetchMakesForVehicleType(vehicleType: string): Promise<string[]> {
  const url = `${VPIC}/GetMakesForVehicleType/${encodeURIComponent(vehicleType)}?format=json`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) return []
  const data = (await res.json()) as { Results?: Array<{ MakeName?: string }> }
  return (data.Results ?? [])
    .map((r) => r.MakeName?.trim())
    .filter((m): m is string => Boolean(m))
}

/** Car / truck / SUV makes for automotive field-service intake (locksmith, detailing, repair). */
export async function fetchPassengerVehicleMakes(): Promise<string[]> {
  if (makesCache && Date.now() - makesCache.at < CACHE_MS) return makesCache.makes

  const batches = await Promise.all(PASSENGER_VEHICLE_TYPES.map((type) => fetchMakesForVehicleType(type)))
  const merged = uniqueSorted(batches.flat())
  const makes = sortMakesForFieldService(merged)

  makesCache = { at: Date.now(), makes }
  return makes
}

/** @deprecated alias — use fetchPassengerVehicleMakes */
export async function fetchAllMakes(): Promise<string[]> {
  return fetchPassengerVehicleMakes()
}

export async function fetchModelsForMakeYear(make: string, year: number): Promise<string[]> {
  const key = `${make.toLowerCase()}::${year}`
  const hit = MODELS_CACHE.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.models

  const url = `${VPIC}/getmodelsformakeyear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) return []

  const data = (await res.json()) as { Results?: Array<{ Model_Name?: string }> }
  const models = uniqueSorted(
    (data.Results ?? [])
      .map((r) => r.Model_Name?.trim())
      .filter((m): m is string => Boolean(m) && isConsumerVehicleModel(m))
  ).sort((a, b) => a.localeCompare(b))

  MODELS_CACHE.set(key, { at: Date.now(), models })
  return models
}

export type VinDecodeResult = {
  vin: string
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  error?: string | null
}

export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "")
}

export async function decodeVin(vinRaw: string): Promise<VinDecodeResult> {
  const vin = normalizeVin(vinRaw)
  if (vin.length !== 17) {
    return { vin, vehicle_year: null, vehicle_make: null, vehicle_model: null, error: "VIN must be 17 characters." }
  }
  const url = `${VPIC}/decodevinvalues/${encodeURIComponent(vin)}?format=json`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    return { vin, vehicle_year: null, vehicle_make: null, vehicle_model: null, error: "VIN lookup failed." }
  }
  const data = (await res.json()) as {
    Results?: Array<{ ModelYear?: string; Make?: string; Model?: string; ErrorText?: string }>
  }
  const row = data.Results?.[0]
  if (!row) {
    return { vin, vehicle_year: null, vehicle_make: null, vehicle_model: null, error: "No vehicle found for VIN." }
  }
  if (row.ErrorText && row.ErrorText !== "0 - VIN decoded clean.") {
    return { vin, vehicle_year: null, vehicle_make: null, vehicle_model: null, error: row.ErrorText }
  }
  return {
    vin,
    vehicle_year: row.ModelYear?.trim() || null,
    vehicle_make: row.Make?.trim() || null,
    vehicle_model: row.Model?.trim() || null,
    error: null,
  }
}
