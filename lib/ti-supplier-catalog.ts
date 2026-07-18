// Server-only Neon lookup for Transponder Island `ti_supplier_catalog`.
// Pure matching helpers live in ti-supplier-catalog-shared.ts (client-safe).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  expandMakeSearchAliases,
  rankTiCatalogRows,
  type TiCatalogKeyOption,
  type TiSupplierCatalogRow,
} from "@/lib/ti-supplier-catalog-shared"

export type { TiCatalogKeyOption, TiSupplierCatalogRow }
export {
  buildTiCatalogSpecDescription,
  expandMakeSearchAliases,
  normalizeVehicleToken,
  parseTiTitleYearRange,
  rankTiCatalogRows,
  scoreTiCatalogTitle,
  tiCatalogHitToManualOption,
  titleHasVehicleToken,
  titleMatchesMake,
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

/**
 * Query Neon for TI catalog products whose titles mention make (+ aliases) + model,
 * then keep rows whose year range includes `year` (case-insensitive ILIKE).
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
  if (makeAliases.length === 0) return []

  try {
    const sql = getSql()
    // Dynamic OR across brand aliases (CHEVROLET / Chevy / …) + case-insensitive model.
    const makePatterns = makeAliases.map((alias) => `%${alias}%`)
    const modelPat = `%${model}%`
    const makeClauses = makePatterns.map((_, i) => `title ILIKE $${i + 1}`).join(" OR ")
    const modelParam = makePatterns.length + 1
    const query = `
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
        AND title ILIKE $${modelParam}
        AND TRIM(ti_sku) <> ''
      ORDER BY ti_sku
      LIMIT 250
    `
    const rows = (await sql.query(query, [...makePatterns, modelPat])) as Record<string, unknown>[]
    const mapped = rows.map(mapCatalogRow)
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
