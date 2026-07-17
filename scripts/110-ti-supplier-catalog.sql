-- Transponder Island full-catalog scrape + Key Inventory scrape fields.
-- Run after 105–108. See scripts/MIGRATE-ALL.md.
--
-- 1) Shared catalog table (all TI products, not tied to one user's stock).
-- 2) Extra columns on key_inventory so stock rows can store scrape metadata.

-- ── Shared TI supplier catalog (upsert target for scripts/import-ti-catalog.ts) ──
CREATE TABLE IF NOT EXISTS ti_supplier_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Primary Transponder Island SKU (e.g. TIK-SUB-37A).
  ti_sku TEXT NOT NULL DEFAULT '',
  -- Cross-reference TI SKU when listed separately (e.g. C/R TI).
  cross_ref_ti_sku TEXT,
  -- Product title from the TI PDP / listing.
  title TEXT NOT NULL DEFAULT '',
  -- FCC ID when present on the product page.
  fcc_id TEXT NOT NULL DEFAULT '',
  -- RF frequency label (e.g. "434 MHz").
  frequency TEXT NOT NULL DEFAULT '',
  -- Button count parsed from title/specs (0 = unknown).
  button_count INTEGER NOT NULL DEFAULT 0 CHECK (button_count >= 0),
  -- Product image URL (TI CDN).
  image_url TEXT,
  -- Canonical product page URL (unique upsert key).
  product_url TEXT NOT NULL,
  -- Optional scrape error note from the last import.
  scrape_error TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ti_supplier_catalog_product_url_uniq UNIQUE (product_url)
);

CREATE INDEX IF NOT EXISTS ti_supplier_catalog_ti_sku_idx
  ON ti_supplier_catalog (ti_sku);

CREATE INDEX IF NOT EXISTS ti_supplier_catalog_fcc_id_upper_idx
  ON ti_supplier_catalog (upper(regexp_replace(fcc_id, '[^A-Za-z0-9]', '', 'g')));

CREATE INDEX IF NOT EXISTS ti_supplier_catalog_cross_ref_ti_sku_idx
  ON ti_supplier_catalog (cross_ref_ti_sku);

COMMENT ON TABLE ti_supplier_catalog IS
  'Full Transponder Island product scrape (scripts/scrape-ti.js → ti_catalog.json → import-ti-catalog).';

-- ── Key Inventory: hold the same scrape fields on stock rows ──
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS product_title TEXT;

ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS product_url TEXT;

ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS cross_ref_ti_sku TEXT;

COMMENT ON COLUMN key_inventory.product_title IS
  'TI / supplier product title from catalog scrape.';
COMMENT ON COLUMN key_inventory.product_url IS
  'Canonical Transponder Island product URL.';
COMMENT ON COLUMN key_inventory.cross_ref_ti_sku IS
  'Alternate TI SKU cross-reference (C/R TI), e.g. TIK-SUB-37A.';

CREATE INDEX IF NOT EXISTS key_inventory_product_url_idx
  ON key_inventory (product_url);

CREATE INDEX IF NOT EXISTS key_inventory_cross_ref_ti_sku_idx
  ON key_inventory (cross_ref_ti_sku);
