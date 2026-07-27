-- ============================================
-- 120 — Customer vehicle garage (CRM)
-- ============================================
-- Vehicles owned by a customer (not only on a single job's collected JSON).
-- Run in Neon → SQL Editor after prior migrations.

CREATE TABLE IF NOT EXISTS customer_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year TEXT NOT NULL DEFAULT '',
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  fcc_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_vehicles_customer
  ON customer_vehicles (customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_vehicles_user
  ON customer_vehicles (user_id, updated_at DESC);

-- Soft link jobs → customers for reliable service history (phone match remains fallback).
ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_leads_customer_id
  ON ai_leads (customer_id)
  WHERE customer_id IS NOT NULL;
