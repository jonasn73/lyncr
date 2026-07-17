-- Key Inventory — Transponder Island + alternative supplier catalog fields.
-- Extends key_inventory (105/106). Run in Neon → SQL Editor. See scripts/MIGRATE-ALL.md.
--
-- Column map (API camelCase → SQL):
--   fccId → fcc_id
--   frequency → frequency
--   buttonCount → button_count
--   tiSku → ti_sku
--   altSku → alt_sku
--   supplierName → supplier_name
--   imageUrl → image_url
--   van1Qty → van1_quantity
--   shopQty → shop_quantity
--   reorderThreshold → minimum_stock_alert

-- RF frequency label (e.g. "902 MHz", "434 MHz").
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT '';

-- Physical button count on the fob/remote.
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS button_count INTEGER NOT NULL DEFAULT 0
  CHECK (button_count >= 0);

-- Primary supplier SKU (Transponder Island), e.g. TIK-FOR-52A.
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS ti_sku TEXT;

-- Fallback / non-TI supplier SKU when TI is unavailable.
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS alt_sku TEXT;

-- Supplier label — defaults to Transponder Island.
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS supplier_name TEXT NOT NULL DEFAULT 'Transponder Island';

-- Key photo URL (uploaded asset or TI scraper link).
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Reorder warning default for new rows (existing column; raise default to 2).
ALTER TABLE key_inventory
  ALTER COLUMN minimum_stock_alert SET DEFAULT 2;

-- Backfill TI SKU from legacy catalog `sku` when empty.
UPDATE key_inventory
SET ti_sku = NULLIF(trim(sku), '')
WHERE ti_sku IS NULL OR trim(ti_sku) = '';

-- Ensure supplier default is present on any legacy nulls (defensive).
UPDATE key_inventory
SET supplier_name = 'Transponder Island'
WHERE supplier_name IS NULL OR trim(supplier_name) = '';

CREATE INDEX IF NOT EXISTS key_inventory_ti_sku_idx
  ON key_inventory (ti_sku);

CREATE INDEX IF NOT EXISTS key_inventory_alt_sku_idx
  ON key_inventory (alt_sku);

CREATE INDEX IF NOT EXISTS key_inventory_supplier_name_idx
  ON key_inventory (supplier_name);

COMMENT ON COLUMN key_inventory.frequency IS 'RF frequency label, e.g. 902 MHz or 434 MHz.';
COMMENT ON COLUMN key_inventory.button_count IS 'Number of buttons on the key/fob.';
COMMENT ON COLUMN key_inventory.ti_sku IS 'Transponder Island (primary supplier) SKU, e.g. TIK-FOR-52A.';
COMMENT ON COLUMN key_inventory.alt_sku IS 'Alternate supplier SKU when not ordering from TI.';
COMMENT ON COLUMN key_inventory.supplier_name IS 'Supplier name; defaults to Transponder Island.';
COMMENT ON COLUMN key_inventory.image_url IS 'Key image URL (upload or TI scraper).';
COMMENT ON COLUMN key_inventory.van1_quantity IS 'API: van1Qty — current stock in Van 1.';
COMMENT ON COLUMN key_inventory.shop_quantity IS 'API: shopQty — back-up stock at home base.';
COMMENT ON COLUMN key_inventory.minimum_stock_alert IS 'API: reorderThreshold — reorder when total stock drops below this (default 2).';
COMMENT ON COLUMN key_inventory.fcc_id IS 'API: fccId — universal FCC identifier for matching.';
