// Year validity for Year → Make → Model intake.
// Only curated hard discontinuations hide options (e.g. 2022 Cruze).
// FCC last-seen years are informational — never treat them as “discontinued”.

import rangesFile from "@/data/vehicle-model-year-ranges.json"

export type VehicleModelYearRange = {
  make: string
  model: string
  start: number
  end: number
  /** When true, year outside start–end must be hidden from the picker. */
  hard?: boolean
  fccStart?: number | null
  fccEnd?: number | null
}

type RangesFile = {
  ranges: VehicleModelYearRange[]
}

const file = rangesFile as RangesFile

/** make|model → hard production window */
const HARD_BY_KEY = new Map<string, { start: number; end: number }>()
/** make → hard model ranges */
const HARD_BY_MAKE = new Map<string, VehicleModelYearRange[]>()

for (const row of file.ranges) {
  const make = row.make.trim().toUpperCase()
  const model = row.model.trim().toUpperCase()
  if (!make || !model) continue
  // Legacy JSON without `hard` treated the FCC span as hard — only trust explicit hard:true
  // after the generator rewrite. Rows with end>=2090 are never hard filters.
  const isHard = row.hard === true && row.end < 2090
  if (!isHard) continue
  const key = `${make}|${model}`
  HARD_BY_KEY.set(key, { start: row.start, end: row.end })
  const list = HARD_BY_MAKE.get(make) ?? []
  list.push({ make, model, start: row.start, end: row.end, hard: true })
  HARD_BY_MAKE.set(make, list)
}

function normMake(make: string): string {
  return make.trim().toUpperCase()
}

function normModel(model: string): string {
  return model.trim().toUpperCase().replace(/\s+/g, " ")
}

function rangeKey(make: string, model: string): string {
  return `${normMake(make)}|${normModel(model)}`
}

/** Look up a curated hard production window (null if we do not hard-filter this model). */
export function getVehicleModelYearRange(
  make: string,
  model: string
): { start: number; end: number } | null {
  return HARD_BY_KEY.get(rangeKey(make, model)) ?? null
}

/**
 * True when this year/make/model is allowed in the picker / key lookup.
 * Unknown models (no hard range) always return true so NHTSA + exotic vehicles work.
 */
export function isVehicleYearMakeModelValid(
  year: number | string,
  make: string,
  model: string
): boolean {
  const y = typeof year === "number" ? year : Number.parseInt(String(year), 10)
  if (!Number.isFinite(y) || !make.trim() || !model.trim()) return false
  const range = getVehicleModelYearRange(make, model)
  if (!range) return true
  return y >= range.start && y <= range.end
}

/** Drop NHTSA model names that are known not to exist for this year. */
export function filterModelsForYear(
  make: string,
  year: number,
  models: string[]
): string[] {
  if (!Number.isFinite(year) || !make.trim()) return models
  return models.filter((model) => isVehicleYearMakeModelValid(year, make, model))
}

/** @deprecated Make lists stay unfiltered — hard discontinuations apply at model level only. */
export function knownMakesForYear(_year: number): Set<string> {
  return new Set()
}

/** Makes that appear in the hard-discontinuation table. */
export function knownMakes(): Set<string> {
  return new Set(HARD_BY_MAKE.keys())
}

/**
 * Make lists are not year-filtered here. Hiding an entire make when only some
 * models were discontinued (e.g. Cruze) would incorrectly drop Chevrolet.
 * Model filtering via filterModelsForYear is the source of truth.
 */
export function filterMakesForYear(_year: number, makes: string[]): string[] {
  return makes
}
