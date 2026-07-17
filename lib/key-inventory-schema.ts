/**
 * KeyInventory schema (exported TypeScript shape).
 *
 * This project uses Neon Postgres + SQL migrations (not Prisma).
 * SQL source of truth: scripts/105–108 + 110 (`key_inventory` + `ti_supplier_catalog`).
 *
 * CamelCase fields below map 1:1 to API / app usage.
 * Snake_case DB columns are noted in comments.
 */

/** Compatible Year/Make/Model range stored in `compatible_vehicles` JSONB. */
export type KeyInventoryCompatibleVehicleSchema = {
  make: string
  model: string
  yearStart: number
  yearEnd: number
}

/**
 * Canonical KeyInventory record (supplier-aware catalog + stock).
 *
 * Primary supplier: Transponder Island (`tiSku` / `supplierName`).
 * Fallback suppliers: `altSku` + customized `supplierName`.
 */
export type KeyInventorySchema = {
  /** UUID primary key → `id` */
  id: string
  /** Owner account → `user_id` (multi-tenant; required in Lyncr) */
  userId: string
  /** Optional workspace → `organization_id` */
  organizationId: string | null
  /**
   * Universal FCC identifier → `fcc_id`
   * @example "M3N-A2C931426" or "YGOHUF8432"
   */
  fccId: string
  /**
   * RF frequency label → `frequency`
   * @example "902 MHz" | "434 MHz"
   */
  frequency: string
  /** Physical button count → `button_count` */
  buttonCount: number
  /**
   * Transponder Island SKU → `ti_sku` (optional)
   * @example "TIK-FOR-52A"
   */
  tiSku: string | null
  /** Non-TI / fallback supplier SKU → `alt_sku` (optional) */
  altSku: string | null
  /**
   * Supplier display name → `supplier_name`
   * @default "Transponder Island"
   */
  supplierName: string
  /**
   * Key photo URL → `image_url`
   * (custom upload or TI scraper link)
   */
  imageUrl: string | null
  /** TI product title from scrape → `product_title` */
  productTitle: string | null
  /** Canonical TI product page → `product_url` */
  productUrl: string | null
  /** C/R TI alternate SKU → `cross_ref_ti_sku` */
  crossRefTiSku: string | null
  /** Van 1 stock → `van1_quantity` @default 0 */
  van1Qty: number
  /** Van 2 stock → `van2_quantity` @default 0 (Lyncr extension) */
  van2Qty: number
  /** Shop / home-base stock → `shop_quantity` @default 0 */
  shopQty: number
  /**
   * Reorder warning threshold → `minimum_stock_alert`
   * @default 2
   */
  reorderThreshold: number
  /** Legacy catalog code → `sku` (often mirrors `tiSku`) */
  sku: string
  /** Brand / blank brand → `brand` */
  brand: string
  /** YMM ranges → `compatible_vehicles` JSONB */
  compatibleVehicles: KeyInventoryCompatibleVehicleSchema[]
  /** Specialty / Dealer-Only → `is_specialty` */
  isSpecialty: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Default supplier constant for inserts. */
export const KEY_INVENTORY_DEFAULT_SUPPLIER = "Transponder Island" as const

/** Default reorder threshold for new rows. */
export const KEY_INVENTORY_DEFAULT_REORDER_THRESHOLD = 2

/**
 * Prisma-style model documentation (reference only — not executed).
 * Lyncr persists via `scripts/107-key-inventory-supplier-catalog.sql`.
 *
 * ```prisma
 * model KeyInventory {
 *   id                String   @id @default(uuid()) @db.Uuid
 *   fccId             String   @map("fcc_id")
 *   frequency         String   @default("")
 *   buttonCount       Int      @default(0) @map("button_count")
 *   tiSku             String?  @map("ti_sku")
 *   altSku            String?  @map("alt_sku")
 *   supplierName      String   @default("Transponder Island") @map("supplier_name")
 *   imageUrl          String?  @map("image_url")
 *   van1Qty           Int      @default(0) @map("van1_quantity")
 *   shopQty           Int      @default(0) @map("shop_quantity")
 *   reorderThreshold  Int      @default(2) @map("minimum_stock_alert")
 *   @@map("key_inventory")
 * }
 * ```
 */
export const KEY_INVENTORY_PRISMA_REFERENCE = "key_inventory" as const
