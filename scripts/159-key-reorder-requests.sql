-- 159: Key reorder requests — a tech flags an out-of-stock key from Key Lookup, the owner
-- approves/denies, then tracks the manual Transponder Island order through to receipt.
--
-- Transponder Island has no ordering API (this app's TI data is a scraped catalog snapshot —
-- see scripts/scrape-ti.js / ti_supplier_catalog, 110) and no price data, so this table does
-- not automate a purchase or enforce a spending limit. It queues the request, lets the owner
-- approve/deny, and tracks ordered -> received (which restocks key_inventory — see 160's
-- key_inventory_ledger for the resulting quantity change).
--
-- Snapshot fields (ti_sku, title, vehicle_*, etc.) are captured at request time and never
-- re-derived, so the request still reads correctly if the catalog listing or key_inventory
-- row changes later.
--
-- Run in Neon SQL Editor after 105-key-inventory.sql. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS key_reorder_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id       UUID REFERENCES organizations(id) ON DELETE SET NULL,
  -- The live stock row, when one exists yet — created on first receipt if not.
  key_inventory_id      UUID REFERENCES key_inventory(id) ON DELETE SET NULL,

  -- Snapshot of what was requested, independent of key_inventory / ti_supplier_catalog.
  ti_sku                TEXT NOT NULL,
  title                 TEXT NOT NULL DEFAULT '',
  fcc_id                TEXT NOT NULL DEFAULT '',
  product_url           TEXT NOT NULL DEFAULT '',
  image_url             TEXT,
  vehicle_year          TEXT,
  vehicle_make          TEXT,
  vehicle_model         TEXT,

  quantity              INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  requested_by_role     TEXT NOT NULL CHECK (requested_by_role IN ('owner', 'field_tech')),
  requested_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Name snapshot — survives the requesting tech being removed later.
  requested_by_label    TEXT NOT NULL DEFAULT '',

  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'denied', 'ordered', 'received', 'cancelled')),
  decided_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at            TIMESTAMPTZ,
  denial_reason         TEXT,
  ordered_at            TIMESTAMPTZ,
  received_at           TIMESTAMPTZ,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS key_reorder_requests_owner_status_idx
  ON key_reorder_requests (owner_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS key_reorder_requests_inventory_idx
  ON key_reorder_requests (key_inventory_id)
  WHERE key_inventory_id IS NOT NULL;

COMMENT ON TABLE key_reorder_requests IS
  'Tech-flagged out-of-stock key requests, queued for owner approval and tracked through manual Transponder Island ordering to receipt.';
COMMENT ON COLUMN key_reorder_requests.ti_sku IS
  'Transponder Island SKU at request time — snapshot, not a live join.';
COMMENT ON COLUMN key_reorder_requests.status IS
  'pending -> approved -> ordered -> received (terminal, restocks inventory), or pending -> denied, or -> cancelled from any non-terminal state.';
