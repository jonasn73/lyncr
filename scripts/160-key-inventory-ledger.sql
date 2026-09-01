-- 160: Append-only ledger for every key_inventory quantity change.
--
-- key_inventory only ever stored the current van1/van2/shop counts — nothing recorded when a
-- count changed, why, or who did it. That's what this table is for: one row per adjustment
-- (owner or tech scan, a new SKU's initial stock, or a reorder request being received), so
-- the owner can see actual usage over time instead of just today's snapshot. Same
-- append-only shape as earnings_ledger (145) — a correction is a new row, never an edit.
--
-- Run in Neon SQL Editor after 105-key-inventory.sql and 159-key-reorder-requests.sql.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS key_inventory_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_inventory_id    UUID NOT NULL REFERENCES key_inventory(id) ON DELETE CASCADE,

  location            TEXT NOT NULL CHECK (location IN ('van1', 'van2', 'shop')),
  -- Signed. Negative = pulled for a job / removed on a scan; positive = restocked.
  delta                INTEGER NOT NULL,
  -- That location's quantity immediately after this row — avoids re-deriving history to show
  -- a running total.
  balance_after        INTEGER NOT NULL,

  reason               TEXT NOT NULL
                          CHECK (reason IN ('scan_adjust', 'new_sku_initial', 'reorder_received')),

  actor_role           TEXT NOT NULL CHECK (actor_role IN ('owner', 'field_tech')),
  actor_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Name snapshot — survives the acting owner/tech account being removed later.
  actor_label          TEXT NOT NULL DEFAULT '',

  -- Set when reason = 'reorder_received' — links the restock back to the approved request.
  reorder_request_id   UUID REFERENCES key_reorder_requests(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS key_inventory_ledger_owner_created_idx
  ON key_inventory_ledger (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS key_inventory_ledger_item_created_idx
  ON key_inventory_ledger (key_inventory_id, created_at DESC);

COMMENT ON TABLE key_inventory_ledger IS
  'Append-only log of every key_inventory quantity change — powers the owner Usage view. Never updated or deleted; a correction is a new row.';
COMMENT ON COLUMN key_inventory_ledger.balance_after IS
  'That location''s quantity immediately after this row, so a history read never has to re-derive a running total.';
