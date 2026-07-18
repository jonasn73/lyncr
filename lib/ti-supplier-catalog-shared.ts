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

/** Strip spaces/hyphens so "CX-3", "CX 3", and "CX3" compare equal. */
export function compactVehicleToken(value: string): string {
  return normalizeVehicleToken(value).replace(/[\s\-_.]/g, "")
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
 * Known model spellings that supplier titles mix (hyphen vs glued, nicknames).
 * Used for SQL ILIKE + title matching.
 */
const VEHICLE_MODEL_ALIAS_GROUPS: string[][] = [
  ["cx-3", "cx3", "cx 3"],
  ["cx-5", "cx5", "cx 5"],
  ["cx-7", "cx7", "cx 7"],
  ["cx-9", "cx9", "cx 9"],
  ["cx-30", "cx30", "cx 30"],
  ["cx-50", "cx50", "cx 50"],
  ["cx-70", "cx70", "cx 70"],
  ["cx-90", "cx90", "cx 90"],
  ["mx-5", "mx5", "mx 5", "miata"],
  ["mx-30", "mx30", "mx 30"],
  ["f-150", "f150", "f 150"],
  ["f-250", "f250", "f 250"],
  ["f-350", "f350", "f 350"],
  ["f-450", "f450", "f 450"],
  ["f-550", "f550", "f 550"],
  ["cr-v", "crv", "cr v"],
  ["hr-v", "hrv", "hr v"],
  ["br-v", "brv", "br v"],
  ["rav4", "rav 4", "rav-4"],
  ["c-hr", "chr", "c hr"],
  ["c-class", "c class", "cclass"],
  ["e-class", "e class", "eclass"],
  ["s-class", "s class", "sclass"],
  ["glc", "glc-class", "glc class"],
  ["gla", "gla-class", "gla class"],
  ["santa fe", "santafe", "santa-fe"],
  ["grand cherokee", "grandcherokee"],
  ["model 3", "model3"],
  ["model y", "modely"],
  ["model s", "models"],
  ["model x", "modelx"],
]

/** Push unique trimmed aliases into `out` (dedupe by normalized form). */
function pushUniqueAlias(out: string[], seen: Set<string>, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) return
  const norm = normalizeVehicleToken(trimmed)
  if (!norm || seen.has(norm)) return
  seen.add(norm)
  out.push(trimmed)
}

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

  pushUniqueAlias(out, seen, raw)

  for (const group of VEHICLE_MAKE_ALIAS_GROUPS) {
    const norms = group.map(normalizeVehicleToken)
    if (!norms.includes(key)) continue
    for (const alias of group) pushUniqueAlias(out, seen, alias)
  }

  return out
}

/**
 * Expand a model into hyphen / space / compact spellings + known alias groups.
 * Example: "CX-3" → CX-3, CX 3, CX3
 */
export function expandModelSearchAliases(model: string): string[] {
  const raw = model.trim()
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()

  pushUniqueAlias(out, seen, raw)

  // Spaces instead of hyphens/underscores ("CX-3" → "CX 3").
  const spaced = raw.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim()
  pushUniqueAlias(out, seen, spaced)

  // Fully compact ("CX-3" → "CX3").
  const compact = raw.replace(/[\s\-_]/g, "")
  pushUniqueAlias(out, seen, compact)

  // Letter↔digit hyphenation ("CX3" → "CX-3", "F150" → "F-150").
  if (compact) {
    const hyphenated = compact
      .replace(/([A-Za-z])(\d)/g, "$1-$2")
      .replace(/(\d)([A-Za-z])/g, "$1-$2")
    pushUniqueAlias(out, seen, hyphenated)
  }

  const key = normalizeVehicleToken(raw)
  const keyCompact = compactVehicleToken(raw)
  for (const group of VEHICLE_MODEL_ALIAS_GROUPS) {
    const norms = group.map(normalizeVehicleToken)
    const compacts = group.map(compactVehicleToken)
    if (!norms.includes(key) && !compacts.includes(keyCompact)) continue
    for (const alias of group) pushUniqueAlias(out, seen, alias)
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
  if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack)) {
    return true
  }

  // Compact match: title "CX-3" should hit needle "CX3" (and the reverse).
  // Skip tiny numeric-only needles ("3") — they collide with button counts (3B).
  const compactNeedle = compactVehicleToken(needle)
  if (compactNeedle.length < 3 || !/[a-z]/i.test(compactNeedle)) return false
  return compactVehicleToken(haystack).includes(compactNeedle)
}

/** True when the title mentions the make or any of its brand aliases. */
export function titleMatchesMake(title: string, make: string): boolean {
  return expandMakeSearchAliases(make).some((alias) => titleHasVehicleToken(title, alias))
}

/** True when the title mentions the model or any spelling alias (CX-3 / CX3 / …). */
export function titleMatchesModel(title: string, model: string): boolean {
  return expandModelSearchAliases(model).some((alias) => titleHasVehicleToken(title, alias))
}

/** Years outside the catalog range still count as a soft hit within this many years. */
const NEAR_YEAR_SLACK = 2

/** Common named models used to detect "wrong car" on make-level platform keys. */
const KNOWN_NAMED_MODELS: string[] = [
  "equinox",
  "malibu",
  "cruze",
  "sonic",
  "spark",
  "trax",
  "traverse",
  "tahoe",
  "suburban",
  "silverado",
  "colorado",
  "camaro",
  "impala",
  "altima",
  "sentra",
  "maxima",
  "rogue",
  "pathfinder",
  "murano",
  "versa",
  "frontier",
  "titan",
  "camry",
  "corolla",
  "rav4",
  "highlander",
  "tacoma",
  "tundra",
  "sienna",
  "prius",
  "4runner",
  "accord",
  "civic",
  "cr-v",
  "pilot",
  "odyssey",
  "fit",
  "hr-v",
  "mustang",
  "escape",
  "explorer",
  "edge",
  "fusion",
  "focus",
  "ranger",
  "bronco",
  "expedition",
  "f-150",
  "f-250",
  "f-350",
  "outback",
  "forester",
  "impreza",
  "legacy",
  "crosstrek",
  "wrangler",
  "cherokee",
  "grand cherokee",
  "compass",
  "renegade",
  "tucson",
  "santa fe",
  "elantra",
  "sonata",
  "palisade",
  "kona",
  "sportage",
  "sorento",
  "telluride",
  "forte",
  "optima",
  "mazda2",
  "mazda3",
  "mazda5",
  "mazda6",
  "protege",
  "miata",
  "cx-3",
  "cx-5",
  "cx-7",
  "cx-9",
  "cx-30",
  "cx-50",
  "cx-70",
  "cx-90",
  "mx-5",
  "mx-30",
]

/**
 * Pull compact model markers from a TI title (cx3, equinox, f150, …).
 * Intentionally narrow — do not treat "Key 3B" / part numbers as models.
 */
function extractTitleModelMarkers(title: string): string[] {
  const markers = new Set<string>()

  // Only well-known alphanumeric model families (avoids "Key 3B" → key3b false positives).
  for (const match of title.matchAll(
    /\b((?:cx|mx|rx|cr|hr|br|glc|gla|glb|gle|gls|rav)|[fe])[\s\-]?(\d{1,3}[a-z]?)\b/gi
  )) {
    const token = compactVehicleToken(`${match[1]}${match[2]}`)
    if (!token || token.length < 2) continue
    markers.add(token)
  }

  for (const named of KNOWN_NAMED_MODELS) {
    if (titleHasVehicleToken(title, named)) {
      markers.add(compactVehicleToken(named))
    }
  }

  return [...markers]
}

/**
 * True when a make-level "platform" key title names a different specific model
 * (e.g. CX-5 title must not win for a CX-3 request).
 */
function titleHasConflictingModel(title: string, model: string): boolean {
  const ourAliases = new Set(expandModelSearchAliases(model).map(compactVehicleToken))
  const markers = extractTitleModelMarkers(title)
  const hasOurs = markers.some((marker) => ourAliases.has(marker))
  if (hasOurs) return false
  return markers.some((marker) => !ourAliases.has(marker))
}

/** True for real key fobs / remotes (not random accessory text). */
function titleLooksLikeKeyProduct(title: string): boolean {
  return /smart\s*key|prox|proximity|remote\s*head|flip\s*key|keyless|transponder|remote\s*flip|\bfob\b/i.test(
    title
  )
}

/** Shells / emergency blades alone are weak ordering targets — demote or skip as platform. */
function titleIsAccessoryOnly(title: string): boolean {
  if (/\b(shell|case)\b/i.test(title)) return true
  if (/emergency\s*blade/i.test(title) && !/\b\d\s*B\b/i.test(title)) return true
  return false
}

type YearMatchQuality = "exact" | "near" | "none"

/**
 * Exact = inside printed range.
 * Near = up to NEAR_YEAR_SLACK years *after* the printed end only (catalog lag),
 * never before the start (avoids 2016 Equinox matching a 2018–2021 smart key).
 */
function yearMatchQuality(year: number, start: number, end: number): YearMatchQuality {
  if (year >= start && year <= end) return "exact"
  if (year > end && year <= end + NEAR_YEAR_SLACK) return "near"
  return "none"
}

/** How many years outside the catalog range (0 when inside). */
function yearDistanceOutside(year: number, start: number, end: number): number {
  if (year < start) return start - year
  if (year > end) return year - end
  return 0
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
 *
 * Match tiers:
 * 1) Exact year + make + model alias
 * 2) Exact year + make platform smart/prox key (no conflicting sibling model)
 * 3) Near-year (±2) + make + model alias (covers CX-3 rows that end one year early)
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

  const yq = yearMatchQuality(year, years.start, years.end)
  if (yq === "none") return -1
  if (!titleMatchesMake(title, make)) return -1

  const modelHit = titleMatchesModel(title, model)
  const platformOk =
    !modelHit &&
    yq === "exact" &&
    titleLooksLikeKeyProduct(title) &&
    !titleIsAccessoryOnly(title) &&
    !titleHasConflictingModel(title, model)

  if (!modelHit && !platformOk) return -1
  // Near-year is only for model-named titles — never invent a soft platform hit.
  if (!modelHit && yq !== "exact") return -1

  // Base: model+exact > platform+exact > model+near.
  // Keep near-year clearly below exact-year platform so a 2019 CX-3 prefers
  // "2019-2025 Mazda Smart Key" over "2012-2018 … CX-3" aftermarket blanks.
  let score = modelHit ? (yq === "exact" ? 100 : 55) : 90
  if (yq === "near" && modelHit) {
    score -= yearDistanceOutside(year, years.start, years.end) * 10
  }

  const span = years.end - years.start
  score += Math.max(0, 20 - span)

  // Prefer aftermarket SKUs on exact-year hits only (near-year A-suffix must not leapfrog).
  if (
    yq === "exact" &&
    (/aftermarket/i.test(title) || /[A-Z]$/i.test(tiSku.replace(/[^A-Za-z0-9-]/g, "")))
  ) {
    score += 25
  }
  if (/smart|prox|proximity/i.test(title)) score += 30

  // Prefer titles where the model sits right after a recognized make alias.
  const titleLower = title.toLowerCase()
  for (const modelAlias of expandModelSearchAliases(model)) {
    const modelNorm = normalizeVehicleToken(modelAlias)
    const modelCompact = compactVehicleToken(modelAlias)
    for (const alias of expandMakeSearchAliases(make)) {
      const aliasNorm = normalizeVehicleToken(alias)
      const makeIdx = titleLower.indexOf(aliasNorm)
      if (makeIdx < 0) continue
      const afterMake = titleLower.slice(makeIdx + aliasNorm.length)
      let modelIdx = afterMake.indexOf(modelNorm)
      if (modelIdx < 0 && modelCompact.length >= 3) {
        // Also try compact model in a compacted after-make slice.
        const afterCompact = afterMake.replace(/[\s\-_.]/g, "")
        modelIdx = afterCompact.indexOf(modelCompact)
        if (modelIdx >= 0) {
          // Approximate index back onto spaced text for the "nearby" bonus.
          modelIdx = Math.min(modelIdx, afterMake.length)
        }
      }
      if (modelIdx < 0) continue
      const afterModel = afterMake.slice(modelIdx + modelNorm.length, modelIdx + modelNorm.length + 40)
      if (/^\s*(smart|prox|key|5b|4b|3b|2b|-|,|sonic|spark|cruze|camaro)/i.test(afterModel)) {
        score += 15
        break
      }
      if (modelIdx < 48) {
        score += 8
        break
      }
    }
  }

  // Accessory-only rows can still match when they name the model; keep them low.
  if (titleIsAccessoryOnly(title)) score -= 45

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
