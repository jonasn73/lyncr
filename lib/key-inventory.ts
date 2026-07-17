// Key Inventory — van/shop stock lookup by FCC ID or Year/Make/Model compatibility.
// Server-only (Neon). Used by Fast Lookup decode responses.

import { neon } from "@neondatabase/serverless"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"

export type { KeyInventoryApiRow }
export { shouldShowOutOfStockFallback } from "@/lib/key-inventory-shared"

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
  frequency: string
  buttonCount: number
  tiSku: string | null
  altSku: string | null
  supplierName: string
  imageUrl: string | null
  compatibleVehicles: KeyInventoryCompatibleVehicle[]
  van1Quantity: number
  van2Quantity: number
  shopQuantity: number
  minimumStockAlert: number
  notes: string | null
  /** Specialty / Dealer-Only — not fulfilled from van stock same-day. */
  isSpecialty: boolean
  /** van1 + van2 + shop */
  totalQuantity: number
  /** van1 + van2 only (mobile stock). */
  vanQuantity: number
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
  const vanQuantity = van1 + van2
  const tiSkuRaw = row.ti_sku != null ? String(row.ti_sku).trim() : ""
  const altSkuRaw = row.alt_sku != null ? String(row.alt_sku).trim() : ""
  const imageRaw = row.image_url != null ? String(row.image_url).trim() : ""
  return {
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: row.organization_id != null ? String(row.organization_id) : null,
    sku: String(row.sku ?? ""),
    fccId: String(row.fcc_id ?? ""),
    brand: String(row.brand ?? ""),
    frequency: String(row.frequency ?? ""),
    buttonCount: Number(row.button_count ?? 0) || 0,
    tiSku: tiSkuRaw || null,
    altSku: altSkuRaw || null,
    supplierName: String(row.supplier_name ?? "Transponder Island").trim() || "Transponder Island",
    imageUrl: imageRaw || null,
    compatibleVehicles: parseCompatibleVehicles(row.compatible_vehicles),
    van1Quantity: van1,
    van2Quantity: van2,
    shopQuantity: shop,
    minimumStockAlert: minAlert,
    notes: row.notes != null ? String(row.notes) : null,
    isSpecialty: row.is_specialty === true || row.is_specialty === "t" || row.is_specialty === 1,
    totalQuantity: total,
    vanQuantity,
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
export function serializeKeyInventoryForApi(rows: KeyInventoryRow[]): KeyInventoryApiRow[] {
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    fccId: row.fccId,
    brand: row.brand,
    frequency: row.frequency,
    buttonCount: row.buttonCount,
    tiSku: row.tiSku,
    altSku: row.altSku,
    supplierName: row.supplierName,
    imageUrl: row.imageUrl,
    compatibleVehicles: row.compatibleVehicles,
    van1Quantity: row.van1Quantity,
    van2Quantity: row.van2Quantity,
    shopQuantity: row.shopQuantity,
    minimumStockAlert: row.minimumStockAlert,
    van1Qty: row.van1Quantity,
    shopQty: row.shopQuantity,
    reorderThreshold: row.minimumStockAlert,
    isSpecialty: row.isSpecialty,
    totalQuantity: row.totalQuantity,
    vanQuantity: row.vanQuantity,
    lowStock: row.lowStock,
    notes: row.notes,
  }))
}

export type KeyInventoryStockLocation = "van1" | "van2" | "shop"

/** Normalize barcode / typed SKU for lookup (trim + uppercase). */
export function normalizeInventorySku(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase()
}

/** Look up one inventory row by SKU for the signed-in owner. */
export async function getKeyInventoryBySku(
  userId: string,
  skuRaw: string,
  organizationId?: string | null
): Promise<KeyInventoryRow | null> {
  const sku = normalizeInventorySku(skuRaw)
  if (!userId || !sku) return null
  const orgId = organizationId?.trim() || null

  try {
    const sql = getSql()
    const rows = orgId
      ? await sql`
          SELECT *
          FROM key_inventory
          WHERE user_id = ${userId}::uuid
            AND (
              upper(trim(sku)) = ${sku}
              OR upper(trim(coalesce(ti_sku, ''))) = ${sku}
              OR upper(trim(coalesce(alt_sku, ''))) = ${sku}
            )
            AND (
              organization_id = ${orgId}::uuid
              OR organization_id IS NULL
            )
          ORDER BY
            CASE WHEN organization_id = ${orgId}::uuid THEN 0 ELSE 1 END,
            updated_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT *
          FROM key_inventory
          WHERE user_id = ${userId}::uuid
            AND (
              upper(trim(sku)) = ${sku}
              OR upper(trim(coalesce(ti_sku, ''))) = ${sku}
              OR upper(trim(coalesce(alt_sku, ''))) = ${sku}
            )
          ORDER BY updated_at DESC
          LIMIT 1
        `
    const row = (rows as Record<string, unknown>[])[0]
    return row ? mapRow(row) : null
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[key-inventory] table missing — run scripts/105-key-inventory.sql in Neon")
      return null
    }
    throw error
  }
}

/**
 * Adjust stock at one location by ±delta (defaults to van1 for van scans).
 * Clamps at zero so stock cannot go negative.
 */
export async function adjustKeyInventoryQuantity(params: {
  userId: string
  id: string
  delta: number
  location?: KeyInventoryStockLocation
}): Promise<KeyInventoryRow | null> {
  const location = params.location ?? "van1"
  const delta = Math.trunc(params.delta)
  if (!params.userId || !params.id || !Number.isFinite(delta) || delta === 0) return null

  const column =
    location === "van2" ? "van2_quantity" : location === "shop" ? "shop_quantity" : "van1_quantity"

  try {
    const sql = getSql()
    // Dynamic column name is constrained to the three known stock fields above.
    const rows =
      column === "van2_quantity"
        ? await sql`
            UPDATE key_inventory
            SET
              van2_quantity = GREATEST(0, van2_quantity + ${delta}),
              updated_at = now()
            WHERE id = ${params.id}::uuid
              AND user_id = ${params.userId}::uuid
            RETURNING *
          `
        : column === "shop_quantity"
          ? await sql`
              UPDATE key_inventory
              SET
                shop_quantity = GREATEST(0, shop_quantity + ${delta}),
                updated_at = now()
              WHERE id = ${params.id}::uuid
                AND user_id = ${params.userId}::uuid
              RETURNING *
            `
          : await sql`
              UPDATE key_inventory
              SET
                van1_quantity = GREATEST(0, van1_quantity + ${delta}),
                updated_at = now()
              WHERE id = ${params.id}::uuid
                AND user_id = ${params.userId}::uuid
              RETURNING *
            `

    const row = (rows as Record<string, unknown>[])[0]
    return row ? mapRow(row) : null
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn("[key-inventory] table missing — run scripts/105-key-inventory.sql in Neon")
      return null
    }
    throw error
  }
}

export type CreateKeyInventoryInput = {
  userId: string
  organizationId?: string | null
  sku: string
  fccId?: string
  brand?: string
  frequency?: string
  buttonCount?: number
  tiSku?: string | null
  altSku?: string | null
  supplierName?: string
  imageUrl?: string | null
  compatibleVehicles?: KeyInventoryCompatibleVehicle[]
  van1Quantity?: number
  van2Quantity?: number
  shopQuantity?: number
  minimumStockAlert?: number
  notes?: string | null
}

/**
 * Upsert van-1 stock for call-time intake: update existing SKU or insert a new row
 * with YMM compatibility so future lookups match.
 */
export async function upsertKeyInventoryVan1Stock(params: {
  userId: string
  organizationId?: string | null
  sku: string
  fccId?: string
  brand?: string
  van1Quantity: number
  year?: number | string | null
  make?: string | null
  model?: string | null
}): Promise<{ row: KeyInventoryRow; created: boolean }> {
  const sku = normalizeInventorySku(params.sku)
  if (!params.userId || !sku) throw new Error("userId and sku are required")
  const van1 = Math.max(0, Math.trunc(params.van1Quantity))
  const fccId = sanitizeFccIdInput(params.fccId ?? "")
  const brand = String(params.brand ?? "").trim()
  const yearNum = Number(params.year)
  const make = String(params.make ?? "").trim()
  const model = String(params.model ?? "").trim()
  const compatibleVehicles: KeyInventoryCompatibleVehicle[] =
    Number.isFinite(yearNum) && make && model
      ? [{ make, model, yearStart: yearNum, yearEnd: yearNum }]
      : []

  const existing = await getKeyInventoryBySku(params.userId, sku, params.organizationId)
  if (existing) {
    try {
      const sql = getSql()
      const compatibleJson = JSON.stringify(
        existing.compatibleVehicles.length > 0 ? existing.compatibleVehicles : compatibleVehicles
      )
      const rows = await sql`
        UPDATE key_inventory
        SET
          van1_quantity = ${van1},
          fcc_id = CASE WHEN ${fccId} = '' THEN fcc_id ELSE ${fccId} END,
          brand = CASE WHEN ${brand} = '' THEN brand ELSE ${brand} END,
          compatible_vehicles = CASE
            WHEN jsonb_array_length(compatible_vehicles) = 0 AND ${compatibleJson}::jsonb != '[]'::jsonb
              THEN ${compatibleJson}::jsonb
            ELSE compatible_vehicles
          END,
          updated_at = now()
        WHERE id = ${existing.id}::uuid
          AND user_id = ${params.userId}::uuid
        RETURNING *
      `
      const row = (rows as Record<string, unknown>[])[0]
      if (!row) throw new Error("Update failed")
      return { row: mapRow(row), created: false }
    } catch (error) {
      if (isMissingTableError(error)) {
        throw new Error("Key inventory table is missing. Run scripts/105-key-inventory.sql in Neon.")
      }
      throw error
    }
  }

  return createKeyInventoryItem({
    userId: params.userId,
    organizationId: params.organizationId,
    sku,
    fccId,
    brand,
    compatibleVehicles,
    van1Quantity: van1,
    van2Quantity: 0,
    shopQuantity: 0,
    minimumStockAlert: 2,
    tiSku: sku,
    supplierName: "Transponder Island",
  })
}

/** Insert a new inventory SKU (or return existing if SKU already owned). */
export async function createKeyInventoryItem(
  input: CreateKeyInventoryInput
): Promise<{ row: KeyInventoryRow; created: boolean }> {
  const sku = normalizeInventorySku(input.sku)
  if (!input.userId || !sku) {
    throw new Error("userId and sku are required")
  }

  const existing = await getKeyInventoryBySku(input.userId, sku, input.organizationId)
  if (existing) return { row: existing, created: false }

  const fccId = sanitizeFccIdInput(input.fccId ?? "")
  const brand = String(input.brand ?? "").trim()
  const frequency = String(input.frequency ?? "").trim()
  const buttonCount = Math.max(0, Math.trunc(input.buttonCount ?? 0))
  const tiSku = input.tiSku != null ? normalizeInventorySku(String(input.tiSku)) || null : sku
  const altSku =
    input.altSku != null && String(input.altSku).trim()
      ? normalizeInventorySku(String(input.altSku))
      : null
  const supplierName =
    String(input.supplierName ?? "Transponder Island").trim() || "Transponder Island"
  const imageUrl = input.imageUrl?.trim() || null
  const compatible = JSON.stringify(input.compatibleVehicles ?? [])
  const van1 = Math.max(0, Math.trunc(input.van1Quantity ?? 1))
  const van2 = Math.max(0, Math.trunc(input.van2Quantity ?? 0))
  const shop = Math.max(0, Math.trunc(input.shopQuantity ?? 0))
  const minAlert = Math.max(0, Math.trunc(input.minimumStockAlert ?? 2))
  const orgId = input.organizationId?.trim() || null
  const notes = input.notes?.trim() || null

  try {
    const sql = getSql()
    const rows = orgId
      ? await sql`
          INSERT INTO key_inventory (
            user_id, organization_id, sku, fcc_id, brand, frequency, button_count,
            ti_sku, alt_sku, supplier_name, image_url, compatible_vehicles,
            van1_quantity, van2_quantity, shop_quantity, minimum_stock_alert, notes
          ) VALUES (
            ${input.userId}::uuid,
            ${orgId}::uuid,
            ${sku},
            ${fccId},
            ${brand},
            ${frequency},
            ${buttonCount},
            ${tiSku},
            ${altSku},
            ${supplierName},
            ${imageUrl},
            ${compatible}::jsonb,
            ${van1},
            ${van2},
            ${shop},
            ${minAlert},
            ${notes}
          )
          RETURNING *
        `
      : await sql`
          INSERT INTO key_inventory (
            user_id, sku, fcc_id, brand, frequency, button_count,
            ti_sku, alt_sku, supplier_name, image_url, compatible_vehicles,
            van1_quantity, van2_quantity, shop_quantity, minimum_stock_alert, notes
          ) VALUES (
            ${input.userId}::uuid,
            ${sku},
            ${fccId},
            ${brand},
            ${frequency},
            ${buttonCount},
            ${tiSku},
            ${altSku},
            ${supplierName},
            ${imageUrl},
            ${compatible}::jsonb,
            ${van1},
            ${van2},
            ${shop},
            ${minAlert},
            ${notes}
          )
          RETURNING *
        `

    const row = (rows as Record<string, unknown>[])[0]
    if (!row) throw new Error("Insert failed")
    return { row: mapRow(row), created: true }
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new Error("Key inventory table is missing. Run scripts/105-key-inventory.sql in Neon.")
    }
    throw error
  }
}
