/**
 * Upsert scripts/ti_catalog.json into Neon:
 *   1) ti_supplier_catalog (shared catalog — always)
 *   2) key_inventory for TI_IMPORT_USER_ID (optional stock rows at qty 0)
 *
 * Usage:
 *   npx tsx scripts/import-ti-catalog.ts
 *   TI_IMPORT_USER_ID=<uuid> npx tsx scripts/import-ti-catalog.ts
 *
 * Requires DATABASE_URL (or DATABASE_URL_POOLED) in .env / .env.local.
 * Run scripts/110-ti-supplier-catalog.sql in Neon first.
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { neon } from "@neondatabase/serverless"
import { config as loadDotenv } from "dotenv"
import { resolveNeonDatabaseUrl } from "../lib/neon-database-url"

loadDotenv({ path: join(process.cwd(), ".env.local") })
loadDotenv({ path: join(process.cwd(), ".env") })

type TiCatalogRow = {
  title?: string | null
  tiSku?: string | null
  crossRefTiSku?: string | null
  fccId?: string | null
  frequency?: string | null
  buttonCount?: number | null
  imageUrl?: string | null
  productUrl?: string | null
  scrapeError?: string | null
}

const CATALOG_PATH = join(process.cwd(), "scripts", "ti_catalog.json")
const IMPORT_USER_ID = (process.env.TI_IMPORT_USER_ID || "").trim()
const IMPORT_ORG_ID = (process.env.TI_IMPORT_ORG_ID || "").trim() || null
const BATCH_SIZE = Number(process.env.TI_IMPORT_BATCH || 50)

function checkpoint(step: string, detail = "") {
  const stamp = new Date().toISOString()
  console.log(`[${stamp}] [TI-IMPORT] ${step}${detail ? ` — ${detail}` : ""}`)
}

function loadCatalog(): TiCatalogRow[] {
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(`Missing ${CATALOG_PATH}. Run npm run scrape:ti first.`)
  }
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as unknown
  if (!Array.isArray(raw)) throw new Error("ti_catalog.json must be a JSON array")
  return raw as TiCatalogRow[]
}

async function main() {
  checkpoint("START", CATALOG_PATH)
  const catalog = loadCatalog().filter((row) => row.productUrl?.trim())
  checkpoint("LOADED", `${catalog.length} product(s) with productUrl`)

  const sql = neon(resolveNeonDatabaseUrl())

  // Verify migration 110 is applied.
  try {
    await sql`SELECT 1 FROM ti_supplier_catalog LIMIT 1`
  } catch (err) {
    checkpoint(
      "MISSING_TABLE",
      "ti_supplier_catalog not found — run scripts/110-ti-supplier-catalog.sql in Neon first"
    )
    throw err
  }

  let catalogUpserts = 0
  for (let i = 0; i < catalog.length; i += BATCH_SIZE) {
    const batch = catalog.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      const productUrl = String(row.productUrl).trim()
      const tiSku = String(row.tiSku ?? "").trim().toUpperCase()
      const crossRef = row.crossRefTiSku ? String(row.crossRefTiSku).trim().toUpperCase() : null
      const title = String(row.title ?? "").trim()
      const fccId = String(row.fccId ?? "").trim().toUpperCase()
      const frequency = String(row.frequency ?? "").trim()
      const buttonCount = Number(row.buttonCount ?? 0) || 0
      const imageUrl = row.imageUrl ? String(row.imageUrl).trim() : null
      const scrapeError = row.scrapeError ? String(row.scrapeError).trim() : null

      await sql`
        INSERT INTO ti_supplier_catalog (
          ti_sku, cross_ref_ti_sku, title, fcc_id, frequency, button_count,
          image_url, product_url, scrape_error, scraped_at, updated_at
        ) VALUES (
          ${tiSku},
          ${crossRef},
          ${title},
          ${fccId},
          ${frequency},
          ${buttonCount},
          ${imageUrl},
          ${productUrl},
          ${scrapeError},
          now(),
          now()
        )
        ON CONFLICT (product_url) DO UPDATE SET
          ti_sku = EXCLUDED.ti_sku,
          cross_ref_ti_sku = EXCLUDED.cross_ref_ti_sku,
          title = EXCLUDED.title,
          fcc_id = EXCLUDED.fcc_id,
          frequency = EXCLUDED.frequency,
          button_count = EXCLUDED.button_count,
          image_url = EXCLUDED.image_url,
          scrape_error = EXCLUDED.scrape_error,
          scraped_at = now(),
          updated_at = now()
      `
      catalogUpserts += 1
    }
    checkpoint("CATALOG_BATCH", `${Math.min(i + batch.length, catalog.length)}/${catalog.length}`)
  }
  checkpoint("CATALOG_DONE", `${catalogUpserts} upsert(s) into ti_supplier_catalog`)

  if (!IMPORT_USER_ID) {
    checkpoint(
      "INVENTORY_SKIP",
      "Set TI_IMPORT_USER_ID=<user uuid> to also upsert zero-qty key_inventory rows"
    )
    return
  }

  // Confirm user exists before writing stock rows.
  const users = await sql`SELECT id FROM users WHERE id = ${IMPORT_USER_ID}::uuid LIMIT 1`
  if (!users.length) {
    throw new Error(`TI_IMPORT_USER_ID ${IMPORT_USER_ID} not found in users`)
  }

  let inventoryUpserts = 0
  for (let i = 0; i < catalog.length; i += BATCH_SIZE) {
    const batch = catalog.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      const tiSku = String(row.tiSku ?? "").trim().toUpperCase()
      if (!tiSku) continue
      const productUrl = String(row.productUrl).trim()
      const crossRef = row.crossRefTiSku ? String(row.crossRefTiSku).trim().toUpperCase() : null
      const title = String(row.title ?? "").trim()
      const fccId = String(row.fccId ?? "").trim().toUpperCase()
      const frequency = String(row.frequency ?? "").trim()
      const buttonCount = Number(row.buttonCount ?? 0) || 0
      const imageUrl = row.imageUrl ? String(row.imageUrl).trim() : null
      const sku = tiSku

      // Prefer match by product_url for this user, else by ti_sku / sku.
      const existing = await sql`
        SELECT id FROM key_inventory
        WHERE user_id = ${IMPORT_USER_ID}::uuid
          AND (
            product_url = ${productUrl}
            OR (ti_sku IS NOT NULL AND upper(ti_sku) = ${tiSku})
            OR upper(sku) = ${sku}
          )
        ORDER BY
          CASE WHEN product_url = ${productUrl} THEN 0 ELSE 1 END
        LIMIT 1
      `

      if (existing.length) {
        await sql`
          UPDATE key_inventory SET
            sku = ${sku},
            ti_sku = ${tiSku},
            cross_ref_ti_sku = ${crossRef},
            product_title = ${title},
            product_url = ${productUrl},
            fcc_id = COALESCE(NULLIF(${fccId}, ''), fcc_id),
            frequency = COALESCE(NULLIF(${frequency}, ''), frequency),
            button_count = CASE WHEN ${buttonCount} > 0 THEN ${buttonCount} ELSE button_count END,
            image_url = COALESCE(${imageUrl}, image_url),
            supplier_name = 'Transponder Island',
            updated_at = now()
          WHERE id = ${String(existing[0].id)}::uuid
        `
      } else {
        await sql`
          INSERT INTO key_inventory (
            user_id, organization_id, sku, fcc_id, brand, frequency, button_count,
            ti_sku, alt_sku, supplier_name, image_url, product_title, product_url,
            cross_ref_ti_sku, compatible_vehicles, van1_quantity, van2_quantity,
            shop_quantity, minimum_stock_alert, notes
          ) VALUES (
            ${IMPORT_USER_ID}::uuid,
            ${IMPORT_ORG_ID},
            ${sku},
            ${fccId},
            'Transponder Island',
            ${frequency},
            ${buttonCount},
            ${tiSku},
            NULL,
            'Transponder Island',
            ${imageUrl},
            ${title},
            ${productUrl},
            ${crossRef},
            '[]'::jsonb,
            0, 0, 0, 2,
            'Imported from TI catalog scrape'
          )
        `
      }
      inventoryUpserts += 1
    }
    checkpoint(
      "INVENTORY_BATCH",
      `${Math.min(i + batch.length, catalog.length)}/${catalog.length}`
    )
  }
  checkpoint("INVENTORY_DONE", `${inventoryUpserts} upsert(s) into key_inventory for ${IMPORT_USER_ID}`)
}

main().catch((err) => {
  checkpoint("FATAL", err instanceof Error ? err.message : String(err))
  console.error(err)
  process.exit(1)
})
