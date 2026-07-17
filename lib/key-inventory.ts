// Key Inventory — van/shop stock lookup by FCC ID or Year/Make/Model compatibility.
// Server-only (Neon). Used by Fast Lookup decode responses.

import { neon } from "@neondatabase/serverless"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type KeyInventoryCompatibleVehicle = {
  make: string
  model: string
  yearStart: number
  yearEnd: number
}

export type KeyInventoryRow = {
  id: string
  userId: string
  organizationId: string | null
  sku: string
  fccId: string
  brand: string
  compatibleVehicles: KeyInventoryCompatibleVehicle[]
  van1Quantity: number
  van2Quantity: number
  shopQuantity: number
  minimumStockAlert: number
  notes: string | null
  /** van1 + van2 + shop */
  totalQuantity: number
  /** True when totalQuantity < minimumStockAlert (and alert > 0). */
  lowStock: boolean
}

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function parseCompatibleVehicles(raw: unknown): KeyInventoryCompatibleVehicle[] {
  if (!Array.isArray(raw)) return []
  const out: KeyInventoryCompatibleVehicle[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const make = String(row.make ?? "").trim()
    const model = String(row.model ?? "").trim()
    const yearStart = Number(row.yearStart ?? row.year_start)
    const yearEnd = Number(row.yearEnd ?? row.year_end)
    if (!make || !model || !Number.isFinite(yearStart) || !Number.isFinite(yearEnd)) continue
    out.push({ make, model, yearStart, yearEnd })
  }
  return out
}

function mapRow(row: Record<string, unknown>): KeyInventoryRow {
  const van1 = Number(row.van1_quantity ?? 0) || 0
  const van2 = Number(row.van2_quantity ?? 0) || 0
  const shop = Number(row.shop_quantity ?? 0) || 0
  const minAlert = Number(row.minimum_stock_alert ?? 0) || 0
  const total = van1 + van2 + shop
  return {
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: row.organization_id != null ? String(row.organization_id) : null,
    sku: String(row.sku ?? ""),
    fccId: String(row.fcc_id ?? ""),
    brand: String(row.brand ?? ""),
    compatibleVehicles: parseCompatibleVehicles(row.compatible_vehicles),
    van1Quantity: van1,
    van2Quantity: van2,
    shopQuantity: shop,
    minimumStockAlert: minAlert,
    notes: row.notes != null ? String(row.notes) : null,
    totalQuantity: total,
    lowStock: minAlert > 0 && total < minAlert,
  }
}

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes("key_inventory") &&
    (msg.includes("does not exist") || msg.includes("undefined_table"))
  )
}

export type KeyInventoryLookupParams = {
  userId: string
  organizationId?: string | null
  year: string | number
  make: string
  model: string
  /** Optional FCC IDs from key-info profiles to match stock by fcc_id. */
  fccIds?: string[] | null
}

/**
 * Find inventory rows that match this vehicle's YMM and/or any of the given FCC IDs.
 * Returns [] when migration 105 has not been applied yet (table missing).
 */
export async function lookupKeyInventoryForVehicle(
  params: KeyInventoryLookupParams
): Promise<KeyInventoryRow[]> {
  const year = typeof params.year === "number" ? params.year : Number(String(params.year).trim())
  const make = params.make.trim()
  const model = params.model.trim()
  if (!params.userId || !Number.isFinite(year) || !make || !model) return []

  const fccList = (params.fccIds ?? [])
    .map((fcc) => sanitizeFccIdInput(fcc))
    .filter(Boolean)
  const orgId = params.organizationId?.trim() || null

  try {
    const sql = getSql()
    const rows = orgId
      ? await sql`
          SELECT *
          FROM key_inventory
          WHERE user_id = ${params.userId}::uuid
            AND (
              organization_id = ${orgId}::uuid
              OR organization_id IS NULL
            )
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements(compatible_vehicles) AS v
                WHERE lower(trim(v->>'make')) = lower(${make})
                  AND lower(trim(v->>'model')) = lower(${model})
                  AND COALESCE((v->>'yearStart')::int, (v->>'year_start')::int, 0) <= ${year}
                  AND COALESCE((v->>'yearEnd')::int, (v->>'year_end')::int, 9999) >= ${year}
              )
              OR upper(regexp_replace(fcc_id, '[^A-Za-z0-9]', '', 'g')) = ANY(${fccList})
            )
          ORDER BY sku ASC
          LIMIT 40
        `
      : await sql`
          SELECT *
          FROM key_inventory
          WHERE user_id = ${params.userId}::uuid
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements(compatible_vehicles) AS v
                WHERE lower(trim(v->>'make')) = lower(${make})
                  AND lower(trim(v->>'model')) = lower(${model})
                  AND COALESCE((v->>'yearStart')::int, (v->>'year_start')::int, 0) <= ${year}
                  AND COALESCE((v->>'yearEnd')::int, (v->>'year_end')::int, 9999) >= ${year}
              )
              OR upper(regexp_replace(fcc_id, '[^A-Za-z0-9]', '', 'g')) = ANY(${fccList})
            )
          ORDER BY sku ASC
          LIMIT 40
        `

    return (rows as Record<string, unknown>[]).map(mapRow)
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[key-inventory] table missing — run scripts/105-key-inventory.sql in Neon")
      return []
    }
    console.error("[key-inventory] lookup failed", error)
    return []
  }
}

/** Compact shape attached to VIN/plate/key-info decode JSON for the intake UI. */
export function serializeKeyInventoryForApi(rows: KeyInventoryRow[]) {
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    fccId: row.fccId,
    brand: row.brand,
    compatibleVehicles: row.compatibleVehicles,
    van1Quantity: row.van1Quantity,
    van2Quantity: row.van2Quantity,
    shopQuantity: row.shopQuantity,
    minimumStockAlert: row.minimumStockAlert,
    totalQuantity: row.totalQuantity,
    lowStock: row.lowStock,
    notes: row.notes,
  }))
}

export type KeyInventoryApiRow = ReturnType<typeof serializeKeyInventoryForApi>[number]
