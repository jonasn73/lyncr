// Server-only Neon lookup for Transponder Island `ti_supplier_catalog`.
// Pure matching helpers live in ti-supplier-catalog-shared.ts (client-safe).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  rankTiCatalogRows,
  type TiCatalogKeyOption,
  type TiSupplierCatalogRow,
} from "@/lib/ti-supplier-catalog-shared"

export type { TiCatalogKeyOption, TiSupplierCatalogRow }
export {
  buildTiCatalogSpecDescription,
  normalizeVehicleToken,
  parseTiTitleYearRange,
  rankTiCatalogRows,
  scoreTiCatalogTitle,
  tiCatalogHitToManualOption,
  titleHasVehicleToken,
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
 * Query Neon for TI catalog products whose titles mention make + model,
 * then keep rows whose year range includes `year`.
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

  try {
    const sql = getSql()
    const makePat = `%${make}%`
    const modelPat = `%${model}%`
    const rows = await sql`
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
      WHERE title ILIKE ${makePat}
        AND title ILIKE ${modelPat}
        AND TRIM(ti_sku) <> ''
      ORDER BY ti_sku
      LIMIT 250
    `
    const mapped = (rows as Record<string, unknown>[]).map(mapCatalogRow)
    return rankTiCatalogRows(mapped, year, make, model, params.limit ?? 8)
  } catch (e) {
    console.warn("[ti-supplier-catalog] lookup failed:", e)
    return []
  }
}
