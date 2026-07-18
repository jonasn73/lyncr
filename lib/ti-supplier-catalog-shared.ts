// Client-safe Transponder Island catalog helpers (no Neon / server imports).
// Matching + card shaping for Key Details; DB fetch lives in ti-supplier-catalog.ts.

import type { ManualKeyFrequencyOption } from "@/lib/fcc-id-input"

/** One row from the shared TI scrape table. */
export type TiSupplierCatalogRow = {
  tiSku: string
  crossRefTiSku: string | null
  title: string
  fccId: string
  frequency: string
  buttonCount: number
  imageUrl: string | null
  productUrl: string
}

/** API / UI-friendly catalog hit for Key Details cards. */
export type TiCatalogKeyOption = {
  tiSku: string
  brand: string
  title: string
  fccId: string
  frequency: string
  buttonCount: number
  imageUrl: string | null
  productUrl: string
  /** Human-readable Spec line for the intake card. */
  description: string
  /** Rank score (higher = better match). */
  score: number
}

/** Normalize make/model for loose title matching. */
export function normalizeVehicleToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Canonical brand key → all catalog / intake spellings we should search for. */
const VEHICLE_MAKE_ALIAS_GROUPS: string[][] = [
  ["chevrolet", "chevy", "chev"],
  ["volkswagen", "vw", "volkswagon"],
  ["mercedes-benz", "mercedes", "mercedes benz", "benz"],
  ["land rover", "landrover"],
  ["alfa romeo", "alfa"],
  ["rolls-royce", "rolls royce", "rollsroyce"],
  ["aston martin", "aston"],
  // RAM / Dodge titles are often interchangeable in supplier catalogs.
  ["ram", "dodge", "dodge ram"],
  ["gmc"],
  ["mini", "mini cooper"],
  ["citroen", "citroën"],
]

/**
 * Expand a make into every alias spelling we should try against TI titles / SQL ILIKE.
 * Always includes the original trimmed make (case-preserved for display elsewhere).
 */
export function expandMakeSearchAliases(make: string): string[] {
  const raw = make.trim()
  if (!raw) return []
  const key = normalizeVehicleToken(raw)
  const out: string[] = []
  const seen = new Set<string>()

  const push = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const norm = normalizeVehicleToken(trimmed)
    if (!norm || seen.has(norm)) return
    seen.add(norm)
    out.push(trimmed)
  }

  push(raw)

  for (const group of VEHICLE_MAKE_ALIAS_GROUPS) {
    const norms = group.map(normalizeVehicleToken)
    if (!norms.includes(key)) continue
    for (const alias of group) push(alias)
  }

  return out
}

/** True when a 4-digit number looks like a vehicle model year (not a frequency like 315/434). */
function isPlausibleModelYear(year: number): boolean {
  return Number.isFinite(year) && year >= 1985 && year <= 2035
}

/**
 * Parse a year or year range from a TI product title.
 * Supports leading ranges ("2019 - 2024 …") and mid-title ranges
 * ("Strattec 2010 - 2018 Chevrolet Equinox …").
 */
export function parseTiTitleYearRange(title: string): { start: number; end: number } | null {
  // Prefer an explicit range anywhere in the title (catalog often prefixes "Strattec").
  const rangeGlobal = title.match(/(\d{4})\s*[-–—]\s*(\d{4})\b/)
  if (rangeGlobal) {
    const start = Number(rangeGlobal[1])
    const end = Number(rangeGlobal[2])
    if (isPlausibleModelYear(start) && isPlausibleModelYear(end) && start <= end) {
      return { start, end }
    }
  }

  // Single year near the start (after an optional brand/vendor word).
  const singleLead = title.match(/^(?:\s*[A-Za-z][\w.-]*\s+)?(\d{4})\b/)
  if (singleLead) {
    const year = Number(singleLead[1])
    if (isPlausibleModelYear(year)) return { start: year, end: year }
  }

  // Last resort: first plausible 4-digit year in the title.
  for (const match of title.matchAll(/\b(\d{4})\b/g)) {
    const year = Number(match[1])
    if (isPlausibleModelYear(year)) return { start: year, end: year }
  }

  return null
}

/** True when `needle` appears as a whole word/token in `haystack` (case-insensitive). */
export function titleHasVehicleToken(haystack: string, needle: string): boolean {
  const n = normalizeVehicleToken(needle)
  if (!n) return false
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack)
}

/** True when the title mentions the make or any of its brand aliases. */
export function titleMatchesMake(title: string, make: string): boolean {
  return expandMakeSearchAliases(make).some((alias) => titleHasVehicleToken(title, alias))
}

/** Infer push-start / remote-head / blade style from the TI title. */
function keyStyleFromTitle(title: string): string {
  const t = title.toLowerCase()
  if (/smart|prox|proximity|push.?start|keyless/.test(t)) return "Push start (smart key)"
  if (/flip/.test(t)) return "Flip key"
  if (/remote\s*head|rhk/.test(t)) return "Remote head key"
  if (/blade|edge\s*cut|transponder/.test(t)) return "Turn key (blade)"
  if (/remote|fob/.test(t)) return "Keyless remote only"
  return "Push start (smart key)"
}

/** Digits-only frequency for ManualKeyFrequencyOption (e.g. "434"). */
function frequencyDigits(frequency: string): string | null {
  const m = frequency.match(/(\d{3,4})/)
  return m?.[1] ?? null
}

/** Build the Spec line shown under the TI SKU badge. */
export function buildTiCatalogSpecDescription(row: {
  title: string
  fccId: string
  frequency: string
  buttonCount: number
}): string {
  const style = keyStyleFromTitle(row.title)
  const isProx = /push start|smart/i.test(style)
  const head = isProx ? "Push-to-start proximity fob" : style
  const fcc = row.fccId.trim() || "—"
  const buttons =
    row.buttonCount > 0 ? `${row.buttonCount}-Button` : /smart|prox/i.test(row.title) ? "Smart" : "Key"
  const freq = row.frequency.trim() || "—"
  return `${head} (FCC ID: ${fcc} / ${buttons} / ${freq})`
}

/**
 * Score a catalog title for the requested Year/Make/Model.
 * Higher score = better primary option (e.g. TIK-NIS-85A for 2022 Nissan Altima).
 */
export function scoreTiCatalogTitle(
  title: string,
  tiSku: string,
  year: number,
  make: string,
  model: string
): number {
  const years = parseTiTitleYearRange(title)
  if (!years) return -1
  // Year must fall inside the catalog range (e.g. 2016 inside 2010–2018).
  if (year < years.start || year > years.end) return -1
  if (!titleMatchesMake(title, make)) return -1
  if (!titleHasVehicleToken(title, model)) return -1

  let score = 100
  const span = years.end - years.start
  score += Math.max(0, 20 - span)

  // Prefer aftermarket SKUs (…85A) / AFTERMARKET titles — shop ordering blanks.
  if (/aftermarket/i.test(title) || /[A-Z]$/i.test(tiSku.replace(/[^A-Za-z0-9-]/g, ""))) {
    score += 25
  }
  if (/smart|prox|proximity/i.test(title)) score += 30

  // Prefer titles where the model sits right after a recognized make alias.
  const titleLower = title.toLowerCase()
  const modelNorm = normalizeVehicleToken(model)
  for (const alias of expandMakeSearchAliases(make)) {
    const aliasNorm = normalizeVehicleToken(alias)
    const makeIdx = titleLower.indexOf(aliasNorm)
    if (makeIdx < 0) continue
    const afterMake = titleLower.slice(makeIdx + aliasNorm.length)
    const modelIdx = afterMake.indexOf(modelNorm)
    if (modelIdx < 0) continue
    const afterModel = afterMake.slice(modelIdx + modelNorm.length, modelIdx + modelNorm.length + 40)
    if (/^\s*(smart|prox|key|5b|4b|3b|2b|-|,|sonic|spark|cruze|camaro)/i.test(afterModel)) {
      score += 15
      break
    }
    // Model present after make is still a good signal.
    if (modelIdx < 48) {
      score += 8
      break
    }
  }

  if (/^TIK-/i.test(tiSku)) score += 10
  return score
}

/** Rank + filter raw catalog rows for a vehicle. */
export function rankTiCatalogRows(
  rows: TiSupplierCatalogRow[],
  year: number,
  make: string,
  model: string,
  limit = 8
): TiCatalogKeyOption[] {
  const brand = make.trim() || "Unknown"
  const scored: TiCatalogKeyOption[] = []

  for (const row of rows) {
    const score = scoreTiCatalogTitle(row.title, row.tiSku, year, make, model)
    if (score < 0) continue
    scored.push({
      tiSku: row.tiSku,
      brand,
      title: row.title,
      fccId: row.fccId,
      frequency: row.frequency,
      buttonCount: row.buttonCount,
      imageUrl: row.imageUrl,
      productUrl: row.productUrl,
      description: buildTiCatalogSpecDescription(row),
      score,
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aAfter = /A$/i.test(a.tiSku) ? 0 : 1
    const bAfter = /A$/i.test(b.tiSku) ? 0 : 1
    if (aAfter !== bAfter) return aAfter - bAfter
    return a.tiSku.localeCompare(b.tiSku)
  })

  const seen = new Set<string>()
  const unique: TiCatalogKeyOption[] = []
  for (const hit of scored) {
    const key = hit.tiSku.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(hit)
    if (unique.length >= limit) break
  }
  return unique
}

/** Convert a TI catalog hit into a ManualKeyFrequencyOption for Key Details cards. */
export function tiCatalogHitToManualOption(hit: TiCatalogKeyOption): ManualKeyFrequencyOption {
  const buttons = hit.buttonCount > 0 ? `${hit.buttonCount}-Button ` : ""
  const style = keyStyleFromTitle(hit.title)
  const label =
    /smart|prox/i.test(hit.title)
      ? `${hit.brand} ${buttons}Smart Prox Key`.replace(/\s+/g, " ").trim()
      : `${hit.brand} ${buttons}${style}`.replace(/\s+/g, " ").trim()

  return {
    id: `ti-catalog-${hit.tiSku}`,
    label,
    keyStyle: style,
    frequency: frequencyDigits(hit.frequency),
    description: hit.description,
    programmingMethod: "OBD2 Programming Required",
    imageUrl: hit.imageUrl,
    fccId: hit.fccId || null,
    catalogSku: hit.tiSku,
    supplierSku: hit.tiSku,
    brand: hit.brand,
  }
}
