// Server-only Neon lookup for Transponder Island `ti_supplier_catalog`.
// Pure matching helpers live in ti-supplier-catalog-shared.ts (client-safe).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  expandMakeSearchAliases,
  expandModelSearchAliases,
  rankTiCatalogRows,
  type TiCatalogKeyOption,
  type TiSupplierCatalogRow,
} from "@/lib/ti-supplier-catalog-shared"

export type { TiCatalogKeyOption, TiSupplierCatalogRow }
export {
  buildTiCatalogSpecDescription,
  compactVehicleToken,
  expandMakeSearchAliases,
  expandModelSearchAliases,
  normalizeVehicleToken,
  parseTiTitleYearRange,
  rankTiCatalogRows,
  scoreTiCatalogTitle,
  tiCatalogHitToManualOption,
  titleHasVehicleToken,
  titleMatchesMake,
  titleMatchesModel,
} from "@/lib/ti-supplier-catalog-shared"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function mapCatalogRow(row: Record<string, unknown>): TiSupplierCatalogRow {
  const imageRaw = row.image_url != null ? String(row.image_url).trim() : ""
  const crossRaw = row.cross_ref_ti_sku != null ? String(row.cross_ref_ti_sku).trim() : ""
  return {
    tiSku: String(row.ti_sku ?? "").trim(),
    crossRefTiSku: crossRaw || null,
    title: String(row.title ?? "").trim(),
    fccId: String(row.fcc_id ?? "").trim(),
    frequency: String(row.frequency ?? "").trim(),
    buttonCount: Number(row.button_count ?? 0) || 0,
    imageUrl: imageRaw || null,
    productUrl: String(row.product_url ?? "").trim(),
  }
}

/** Deduplicate catalog rows by TI SKU (keeps first occurrence). */
function dedupeCatalogRows(rows: TiSupplierCatalogRow[]): TiSupplierCatalogRow[] {
  const seen = new Set<string>()
  const out: TiSupplierCatalogRow[] = []
  for (const row of rows) {
    const key = row.tiSku.toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Query Neon for TI catalog products for this Year/Make/Model.
 *
 * Fetches:
 * 1) Make (+ aliases) + model (+ aliases) — e.g. CX-3 / CX3
 * 2) Make (+ aliases) platform keys (smart/prox/remote) when model-named rows
 *    are missing or year-short — e.g. "2019-2025 Mazda Smart Key"
 *
 * Ranking (near-year + platform) happens in `rankTiCatalogRows`.
 */
export async function lookupTiSupplierCatalogForVehicle(params: {
  year: string | number
  make: string
  model: string
  limit?: number
}): Promise<TiCatalogKeyOption[]> {
  const year = typeof params.year === "number" ? params.year : Number(String(params.year).trim())
  const make = params.make.trim()
  const model = params.model.trim()
  if (!Number.isFinite(year) || !make || !model) return []

  const makeAliases = expandMakeSearchAliases(make)
  const modelAliases = expandModelSearchAliases(model)
  if (makeAliases.length === 0 || modelAliases.length === 0) return []

  try {
    const sql = getSql()
    const makePatterns = makeAliases.map((alias) => `%${alias}%`)
    const modelPatterns = modelAliases.map((alias) => `%${alias}%`)

    // --- Query 1: make + any model spelling ---
    const makeClauses = makePatterns.map((_, i) => `title ILIKE $${i + 1}`).join(" OR ")
    const modelStart = makePatterns.length + 1
    const modelClauses = modelPatterns
      .map((_, i) => `title ILIKE $${modelStart + i}`)
      .join(" OR ")
    const modelQuery = `
      SELECT
        ti_sku,
        cross_ref_ti_sku,
        title,
        fcc_id,
        frequency,
        button_count,
        image_url,
        product_url
      FROM ti_supplier_catalog
      WHERE (${makeClauses})
        AND (${modelClauses})
        AND TRIM(ti_sku) <> ''
      ORDER BY ti_sku
      LIMIT 250
    `
    const modelRows = (await sql.query(modelQuery, [
      ...makePatterns,
      ...modelPatterns,
    ])) as Record<string, unknown>[]

    // --- Query 2: make-level smart/prox/remote platform keys (no model required) ---
    const platformQuery = `
      SELECT
        ti_sku,
        cross_ref_ti_sku,
        title,
        fcc_id,
        frequency,
        button_count,
        image_url,
        product_url
      FROM ti_supplier_catalog
      WHERE (${makeClauses})
        AND (
          title ILIKE '%smart%'
          OR title ILIKE '%prox%'
          OR title ILIKE '%remote%'
          OR title ILIKE '%flip%'
          OR title ILIKE '%keyless%'
          OR title ILIKE '%transponder%'
        )
        AND title NOT ILIKE '%shell%'
        AND title NOT ILIKE '% case%'
        AND TRIM(ti_sku) <> ''
      ORDER BY ti_sku
      LIMIT 200
    `
    const platformRows = (await sql.query(platformQuery, makePatterns)) as Record<
      string,
      unknown
    >[]

    const mapped = dedupeCatalogRows([
      ...modelRows.map(mapCatalogRow),
      ...platformRows.map(mapCatalogRow),
    ])
    const ranked = rankTiCatalogRows(mapped, year, make, model, params.limit ?? 8)

    if (ranked.length === 0) {
      console.warn(
        `[TI CATALOG MISS] No match found for Make: ${make}, Model: ${model}, Year: ${year}`
      )
    }

    return ranked
  } catch (e) {
    console.warn("[ti-supplier-catalog] lookup failed:", e)
    console.warn(
      `[TI CATALOG MISS] No match found for Make: ${make}, Model: ${model}, Year: ${year}`
    )
    return []
  }
}
