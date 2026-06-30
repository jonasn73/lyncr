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

/** Locksmith DB often lists Ram trucks under Dodge (pre/post RAM brand split). */
function equivalentMakeTokens(makeRaw: string): string[] {
  const key = normalizeToken(makeRaw)
  if (key === "ram" || key === "dodge") return ["ram", "dodge"]
  return [key]
}

function makesMatch(rowMake: string, queryMake: string): boolean {
  const rowKeys = new Set(equivalentMakeTokens(rowMake))
  return equivalentMakeTokens(queryMake).some((k) => rowKeys.has(k))
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
    if (/^(1500|2500|3500|4500|5500)$/.test(model)) {
      out.push(`Ram ${modelRaw.trim()}`)
    }
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

  // Ford E-series vans → Econoline in locksmith references
  if (make === "ford" && /^e\d{3}$/i.test(modelRaw.trim().replace(/-/g, ""))) {
    out.push("Econoline")
  }

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

/** RAM/Dodge trucks: NHTSA model "1500" → locksmith DB "Ram 1500" (same vehicle). */
function ramTruckCatalogPair(
  makeRaw: string,
  modelRaw: string
): { make: string; model: string } | null {
  const make = normalizeToken(makeRaw)
  if (make !== "ram" && make !== "dodge") return null
  const tonOnly = modelRaw.trim().match(/^(1500|2500|3500|4500|5500|6500|7500)$/i)?.[1]
  if (tonOnly) return { make: "Dodge", model: `Ram ${tonOnly}` }
  const ramTon = modelRaw.trim().match(/^ram\s+(1500|2500|3500|4500|5500|6500|7500)$/i)
  if (ramTon) return { make: "Dodge", model: `Ram ${ramTon[1]}` }
  return null
}

/** NHTSA sometimes lists Scion under Toyota make — reference DB uses Scion make. */
function alternativeMakeModelPairs(
  makeRaw: string,
  modelRaw: string
): Array<{ make: string; model: string }> {
  const out: Array<{ make: string; model: string }> = []
  const scionModel = modelRaw.match(/^scion\s+(.+)$/i)?.[1]?.trim()
  if (scionModel) out.push({ make: "Scion", model: scionModel })
  if (/^e-\d{3}$/i.test(modelRaw.trim()) && normalizeToken(makeRaw) === "ford") {
    out.push({ make: "Ford", model: "Econoline" })
  }
  return out
}

function profilesForYearMakeModel(year: number, makeRaw: string, modelName: string): VehicleKeyProfile[] {
  const modelKey = normalizeToken(modelName)
  return loadProfiles().filter(
    (r) => r.year === year && makesMatch(r.make, makeRaw) && normalizeToken(r.model) === modelKey
  )
}

function profilesWithFuzzyModel(year: number, makeRaw: string, modelRaw: string): VehicleKeyProfile[] {
  const modelKey = normalizeToken(modelRaw)
  return loadProfiles().filter((r) => {
    if (r.year !== year || !makesMatch(r.make, makeRaw)) return false
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
    const ramTruck = ramTruckCatalogPair(make, model)
    if (ramTruck) {
      profiles = profilesForYearMakeModel(year, ramTruck.make, ramTruck.model)
      if (profiles.length > 0) {
        matchedModel = ramTruck.model
        matchType = "exact"
      }
    }
  }

  if (profiles.length === 0) {
    for (const alt of alternativeMakeModelPairs(make, model)) {
      profiles = profilesForYearMakeModel(year, alt.make, alt.model)
      if (profiles.length > 0) {
        matchedModel = alt.model
        matchType = "family"
        break
      }
    }
  }

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

/** Normalize FCC IDs so `N5F-A08TAA` and `N5FA08TAA` match the same reference rows. */
export function normalizeFccIdForMatch(raw: string): string {
  return raw.trim().replace(/[\s-]+/g, "").toUpperCase()
}

export type CompatibleVehicle = {
  year: number
  make: string
  model: string
}

/** Every year/make/model in our CSV that shares this FCC ID. */
export function lookupCompatibleVehiclesForFcc(fccId: string): CompatibleVehicle[] {
  const key = normalizeFccIdForMatch(fccId)
  const seen = new Set<string>()
  const out: CompatibleVehicle[] = []
  for (const row of loadProfiles()) {
    if (normalizeFccIdForMatch(row.fcc_id) !== key) continue
    const rowKey = `${row.year}|${normalizeToken(row.make)}|${normalizeToken(row.model)}`
    if (seen.has(rowKey)) continue
    seen.add(rowKey)
    out.push({ year: row.year, make: row.make, model: row.model })
  }
  return out.sort(
    (a, b) => a.year - b.year || a.make.localeCompare(b.make) || a.model.localeCompare(b.model)
  )
}

export type CompatibleVehicleGroup = {
  make: string
  model: string
  minYear: number
  maxYear: number
}

/** Collapse many CSV rows into make/model year ranges (e.g. Ford Escape 2007–2018). */
export function groupCompatibleVehicles(vehicles: CompatibleVehicle[]): CompatibleVehicleGroup[] {
  const map = new Map<string, CompatibleVehicleGroup>()
  for (const v of vehicles) {
    const groupKey = `${normalizeToken(v.make)}|${normalizeToken(v.model)}`
    const existing = map.get(groupKey)
    if (!existing) {
      map.set(groupKey, { make: v.make, model: v.model, minYear: v.year, maxYear: v.year })
      continue
    }
    existing.minYear = Math.min(existing.minYear, v.year)
    existing.maxYear = Math.max(existing.maxYear, v.year)
  }
  return [...map.values()].sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model))
}

function formatVehicleGroupLabel(group: CompatibleVehicleGroup, highlightYear?: number): string {
  if (group.minYear === group.maxYear) {
    return `${group.minYear} ${group.make} ${group.model}`
  }
  if (
    highlightYear != null &&
    highlightYear >= group.minYear &&
    highlightYear <= group.maxYear
  ) {
    return `${highlightYear} ${group.make} ${group.model} (${group.minYear}–${group.maxYear})`
  }
  return `${group.make} ${group.model} (${group.minYear}–${group.maxYear})`
}

/** True when two FCC IDs are suffix variants (e.g. M3N-A2C931423 vs M3N-A2C93142300). */
export function areRelatedFccIds(a: string, b: string): boolean {
  const left = normalizeFccIdForMatch(a)
  const right = normalizeFccIdForMatch(b)
  if (left === right) return false
  return left.startsWith(right) || right.startsWith(left)
}

/** Other FCC filings on this vehicle that share the same key family prefix. */
export function relatedFccIdsForProfile(
  fccId: string,
  profiles: Array<{ fcc_id: string; frequency: string | null; modulation: string | null }>
): string[] {
  const self = profiles.find((p) => p.fcc_id === fccId)
  if (!self) return []
  return profiles
    .filter(
      (p) =>
        p.fcc_id !== fccId &&
        areRelatedFccIds(p.fcc_id, fccId) &&
        (p.frequency ?? "") === (self.frequency ?? "") &&
        (p.modulation ?? "") === (self.modulation ?? "")
    )
    .map((p) => p.fcc_id)
}

/** Human-readable compatible-vehicle lines for the intake sheet (current vehicle first). */
export function formatCompatibleVehicleSummary(
  vehicles: CompatibleVehicle[],
  current: { year: number; make: string; model: string },
  maxGroups = 6
): { lines: string[]; overflow: number } {
  const currentMake = normalizeToken(current.make)
  const currentModel = normalizeToken(current.model)
  const groups = groupCompatibleVehicles(vehicles)

  const sameModel = groups.filter(
    (g) => normalizeToken(g.make) === currentMake && normalizeToken(g.model) === currentModel
  )
  const otherModels = groups.filter(
    (g) => !(normalizeToken(g.make) === currentMake && normalizeToken(g.model) === currentModel)
  )

  otherModels.sort((a, b) => {
    const aSameMake = normalizeToken(a.make) === currentMake ? 0 : 1
    const bSameMake = normalizeToken(b.make) === currentMake ? 0 : 1
    if (aSameMake !== bSameMake) return aSameMake - bSameMake
    return a.make.localeCompare(b.make) || a.model.localeCompare(b.model)
  })

  const lines: string[] = []
  for (const group of sameModel) lines.push(formatVehicleGroupLabel(group, current.year))
  for (const group of otherModels.slice(0, maxGroups)) lines.push(formatVehicleGroupLabel(group))

  return { lines, overflow: Math.max(0, otherModels.length - maxGroups) }
}
