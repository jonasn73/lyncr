-- Key Inventory — van / shop stock keyed by SKU + FCC ID, with YMM compatibility JSON.
-- Used by Fast Lookup (VIN/plate decode) to surface on-hand keys for the decoded vehicle.
-- Run in Neon → SQL Editor after pulling this commit. See scripts/MIGRATE-ALL.md.

CREATE TABLE IF NOT EXISTS key_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner account that stocks these blanks / fobs.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Optional workspace scope (multi-business owners).
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  -- Catalog / ordering code (e.g. KEY-VOL-05-PROX).
  sku TEXT NOT NULL,
  -- FCC ID stamped on the key — primary match against key-info profiles.
  fcc_id TEXT NOT NULL DEFAULT '',
  -- Blank / programmer brand (Autel, OEM, aftermarket, etc.).
  brand TEXT NOT NULL DEFAULT '',
  -- Compatible Year/Make/Model ranges, e.g.
  -- [{"make":"Volvo","model":"XC90","yearStart":2016,"yearEnd":2021}]
  compatible_vehicles JSONB NOT NULL DEFAULT '[]'::jsonb,
  van1_quantity INTEGER NOT NULL DEFAULT 0 CHECK (van1_quantity >= 0),
  van2_quantity INTEGER NOT NULL DEFAULT 0 CHECK (van2_quantity >= 0),
  shop_quantity INTEGER NOT NULL DEFAULT 0 CHECK (shop_quantity >= 0),
  -- When total stock (van1+van2+shop) drops below this, surface a reorder warning.
  minimum_stock_alert INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_alert >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS key_inventory_user_id_idx
  ON key_inventory (user_id);

CREATE INDEX IF NOT EXISTS key_inventory_organization_id_idx
  ON key_inventory (organization_id);

CREATE INDEX IF NOT EXISTS key_inventory_sku_idx
  ON key_inventory (sku);

-- Case-insensitive FCC lookups from decode / key-info.
CREATE INDEX IF NOT EXISTS key_inventory_fcc_id_upper_idx
  ON key_inventory (upper(regexp_replace(fcc_id, '[^A-Za-z0-9]', '', 'g')));

CREATE INDEX IF NOT EXISTS key_inventory_compatible_vehicles_gin_idx
  ON key_inventory USING GIN (compatible_vehicles jsonb_path_ops);

COMMENT ON TABLE key_inventory IS
  'Physical key/fob stock per owner (or workspace): SKU, FCC ID, YMM compatibility, van/shop quantities.';
