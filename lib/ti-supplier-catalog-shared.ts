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

/**
 * Parse a leading year or year range from a TI product title.
 * Supports "2019 - 2024 …", "2019–2024 …", and single "2022 …".
 */
export function parseTiTitleYearRange(title: string): { start: number; end: number } | null {
  const range = title.match(/^\s*(\d{4})\s*[-–—]\s*(\d{4})\b/)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
      return { start, end }
    }
  }
  const single = title.match(/^\s*(\d{4})\b/)
  if (single) {
    const year = Number(single[1])
    if (Number.isFinite(year)) return { start: year, end: year }
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
  if (year < years.start || year > years.end) return -1
  if (!titleHasVehicleToken(title, make)) return -1
  if (!titleHasVehicleToken(title, model)) return -1

  let score = 100
  const span = years.end - years.start
  score += Math.max(0, 20 - span)

  // Prefer aftermarket SKUs (…85A) / AFTERMARKET titles — shop ordering blanks.
  if (/aftermarket/i.test(title) || /[A-Z]$/i.test(tiSku.replace(/[^A-Za-z0-9-]/g, ""))) {
    score += 25
  }
  if (/smart|prox|proximity/i.test(title)) score += 30
  const afterMake = title.toLowerCase().split(normalizeVehicleToken(make))[1] ?? ""
  const modelIdx = afterMake.indexOf(normalizeVehicleToken(model))
  if (modelIdx >= 0) {
    const afterModel = afterMake.slice(modelIdx + normalizeVehicleToken(model).length, modelIdx + 40)
    if (/^\s*(smart|prox|key|5b|4b|3b|2b|-|,)/i.test(afterModel)) score += 15
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
