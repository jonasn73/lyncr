// Vehicle key / remote FCC reference (year + make + model → FCC IDs, frequency, chipset).
// Server-only — uses node:fs to load data/vehicle-key-fcc-reference.csv.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export type VehicleKeyProfile = {
  /** Row index in the reference file (stable id for UI selection). */
  id: string
  year: number
  make: string
  model: string
  fcc_id: string
  frequency: string | null
  modulation: string | null
  chipset: string | null
}

export type VehicleKeyLookupResult = {
  year: number
  make: string
  model: string
  /** Model name used in the reference file when different from the picker (e.g. Silverado for 5500HD). */
  matched_model: string
  match_type: "exact" | "family"
  profiles: VehicleKeyProfile[]
  /** Quick search on Transponder Island shop (external). */
  transponder_island_url: string
  /** Keysolved browse page when we have a match (external, subscription for full specs). */
  keysolved_url: string
  source: "keyfobdb"
  disclaimer: string
}

let cachedRows: VehicleKeyProfile[] | null = null

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function csvSplitLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === "," && !inQuotes) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

function loadProfiles(): VehicleKeyProfile[] {
  if (cachedRows) return cachedRows
  const filePath = join(process.cwd(), "data", "vehicle-key-fcc-reference.csv")
  const raw = readFileSync(filePath, "utf8")
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const rows: VehicleKeyProfile[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = csvSplitLine(lines[i]!)
    if (cols.length < 4) continue
    const year = Number(cols[0])
    if (!Number.isFinite(year)) continue
    const make = cols[1]?.trim() ?? ""
    const model = cols[2]?.trim() ?? ""
    const fcc = cols[3]?.trim() ?? ""
    if (!make || !model || !fcc) continue
    rows.push({
      id: String(i),
      year,
      make,
      model,
      fcc_id: fcc,
      frequency: cols[4]?.trim() || null,
      modulation: cols[5]?.trim() || null,
      chipset: cols[8]?.trim() || null,
    })
  }
  cachedRows = rows
  return rows
}

function transponderIslandShopUrl(year: number, make: string, model: string): string {
  const q = `${year} ${make} ${model}`.trim()
  return `https://transponderisland.com/shop?search=${encodeURIComponent(q)}`
}

function keysolvedBrowseUrl(make: string, model: string, year: number): string {
  const slug = `${make}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `https://keysolved.com/vehicles/${slug}/${year}`
}

/** NHTSA commercial trims often differ from locksmith DB names — map to closest line. */
function familyFallbackModels(makeRaw: string, modelRaw: string): string[] {
  const make = normalizeToken(makeRaw)
  const model = normalizeToken(modelRaw)
  const out: string[] = []

  const isHdTruck =
    /^(f\d{3}|f\d{4})/.test(model) ||
    /1500|2500|3500|4500|5500|6500|7500/.test(model) ||
    model.includes("hd") ||
    model.includes("superduty") ||
    model.includes("superduty")

  if (make === "chevrolet" && isHdTruck) out.push("Silverado", "Express", "Suburban", "Tahoe")
  if (make === "gmc" && isHdTruck) out.push("Sierra", "Savana", "Yukon")
  if ((make === "ram" || make === "dodge") && isHdTruck) {
    out.push("Ram 1500", "Ram 2500", "Ram 3500", "Ram 4500", "Ram 5500", "Ram")
  }
  if (make === "ford" && isHdTruck) {
    out.push("F-150", "F-250", "F-350", "F-450", "F-550", "F-650", "F-750")
  }
  if (make === "toyota" && /tundra|tacoma|sequoia/.test(model)) {
    out.push("Tundra", "Tacoma", "Sequoia")
  }
  if (make === "nissan" && /titan|frontier|nv/.test(model)) out.push("Titan", "Frontier", "NV")
  if (make === "honda" && /ridgeline|pilot/.test(model)) out.push("Ridgeline", "Pilot", "CR-V")

  // Strip cab/bed suffixes: "Silverado 1500 Crew Cab" → try token contains "silverado"
  const stripped = modelRaw
    .replace(/\b(crew|regular|double|extended)\s*cab\b/gi, "")
    .replace(/\b\d{4}\s*(hd|xd)?\b/gi, "")
    .trim()
  if (stripped && normalizeToken(stripped) !== model) {
    out.push(stripped)
  }

  return [...new Set(out.map((m) => m.trim()).filter(Boolean))]
}

function profilesForYearMakeModel(year: number, makeRaw: string, modelName: string): VehicleKeyProfile[] {
  const makeKey = normalizeToken(makeRaw)
  const modelKey = normalizeToken(modelName)
  return loadProfiles().filter(
    (r) => r.year === year && normalizeToken(r.make) === makeKey && normalizeToken(r.model) === modelKey
  )
}

function profilesWithFuzzyModel(year: number, makeRaw: string, modelRaw: string): VehicleKeyProfile[] {
  const makeKey = normalizeToken(makeRaw)
  const modelKey = normalizeToken(modelRaw)
  return loadProfiles().filter((r) => {
    if (r.year !== year || normalizeToken(r.make) !== makeKey) return false
    const rowKey = normalizeToken(r.model)
    return rowKey.includes(modelKey) || modelKey.includes(rowKey)
  })
}

function dedupeProfiles(profiles: VehicleKeyProfile[]): VehicleKeyProfile[] {
  const deduped = new Map<string, VehicleKeyProfile>()
  for (const p of profiles) {
    const key = `${p.fcc_id}|${p.frequency ?? ""}|${p.chipset ?? ""}`
    if (!deduped.has(key)) deduped.set(key, p)
  }
  return [...deduped.values()]
}

function buildLookupResult(
  year: number,
  make: string,
  model: string,
  matchedModel: string,
  matchType: "exact" | "family",
  profiles: VehicleKeyProfile[]
): VehicleKeyLookupResult {
  const familyNote =
    matchType === "family"
      ? ` Showing closest reference match (${matchedModel}) — verify key type on the vehicle.`
      : ""
  return {
    year,
    make,
    model,
    matched_model: matchedModel,
    match_type: matchType,
    profiles,
    transponder_island_url: transponderIslandShopUrl(year, make, model),
    keysolved_url: keysolvedBrowseUrl(make, matchedModel, year),
    source: "keyfobdb",
    disclaimer:
      `Reference data from public FCC listings — verify on the vehicle.${familyNote} For full programming steps use Transponder Island or Keysolved.`,
  }
}

/** Look up FCC / frequency profiles for a vehicle year + make + model. */
export function lookupVehicleKeyProfiles(
  yearRaw: string | number,
  makeRaw: string,
  modelRaw: string
): VehicleKeyLookupResult | null {
  const year = typeof yearRaw === "number" ? yearRaw : Number(String(yearRaw).trim())
  const make = makeRaw.trim()
  const model = modelRaw.trim()
  if (!Number.isFinite(year) || year < 1980 || !make || !model) return null

  let profiles = profilesForYearMakeModel(year, make, model)
  let matchedModel = model
  let matchType: "exact" | "family" = "exact"

  if (profiles.length === 0) {
    for (const candidate of familyFallbackModels(make, model)) {
      profiles = profilesForYearMakeModel(year, make, candidate)
      if (profiles.length > 0) {
        matchedModel = candidate
        matchType = "family"
        break
      }
    }
  }

  if (profiles.length === 0) {
    profiles = profilesWithFuzzyModel(year, make, model)
    if (profiles.length > 0) {
      matchedModel = profiles[0]!.model
      matchType = "family"
    }
  }

  profiles = dedupeProfiles(profiles)
  if (profiles.length === 0) return null

  return buildLookupResult(year, make, model, matchedModel, matchType, profiles)
}

export function fccGovSearchUrl(fccId: string): string {
  const clean = fccId.trim().replace(/\s+/g, "")
  return `https://fccid.io/${encodeURIComponent(clean)}`
}
