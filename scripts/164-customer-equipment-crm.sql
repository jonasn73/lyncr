-- ============================================
-- 164 — Customer equipment on file (CRM) — 087
-- ============================================
-- Trade-neutral counterpart to customer_vehicles (120): water heater for plumbing,
-- HVAC unit for HVAC, breaker panel for electrical — see lib/customer-equipment-registry.ts
-- for which trades use this and their kind/label. Deliberately a separate table rather than
-- widening customer_vehicles — that table's vin/fcc_id columns are locksmith/auto concepts
-- with no equivalent here, and the locksmith vehicle flow stays untouched.
-- Run in Neon → SQL Editor after prior migrations.

CREATE TABLE IF NOT EXISTS customer_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- 'water_heater' | 'hvac_unit' | 'electrical_panel' — see EQUIPMENT_AWARE_PROFILES.
  kind TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  install_year TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_equipment_customer
  ON customer_equipment (customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_equipment_user
  ON customer_equipment (user_id, updated_at DESC);
