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

  const makeKey = normalizeToken(make)
  const modelKey = normalizeToken(model)
  const profiles = loadProfiles().filter(
    (r) => r.year === year && normalizeToken(r.make) === makeKey && normalizeToken(r.model) === modelKey
  )

  if (profiles.length === 0) return null

  const deduped = new Map<string, VehicleKeyProfile>()
  for (const p of profiles) {
    const key = `${p.fcc_id}|${p.frequency ?? ""}|${p.chipset ?? ""}`
    if (!deduped.has(key)) deduped.set(key, p)
  }

  return {
    year,
    make,
    model,
    profiles: [...deduped.values()],
    transponder_island_url: transponderIslandShopUrl(year, make, model),
    keysolved_url: keysolvedBrowseUrl(make, model, year),
    source: "keyfobdb",
    disclaimer:
      "Reference data from public FCC listings — verify on the vehicle. For full programming steps use Transponder Island or Keysolved.",
  }
}

export function fccGovSearchUrl(fccId: string): string {
  const clean = fccId.trim().replace(/\s+/g, "")
  return `https://fccid.io/${encodeURIComponent(clean)}`
}
