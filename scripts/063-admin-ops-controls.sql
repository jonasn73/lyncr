-- 063: Platform admin operational controls — tenant feature flags + receptionist payout ledger.
-- Run in Neon SQL Editor after 062-tracking-badges-sms-engine.sql.

-- 1) Per-tenant feature overrides (e.g. field_tech_hud, sms_automation) set from the admin drawer.
ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN onboarding_profiles.feature_flags IS 'Admin-controlled premium feature overrides keyed by flag id (e.g. {"field_tech_hud": true}).';

-- 2) Receptionist payout ledger — every "Mark Paid" writes a balance-reset transaction here.
CREATE TABLE IF NOT EXISTS payout_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receptionist_id UUID NOT NULL REFERENCES receptionists(id) ON DELETE CASCADE,
  amount_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  minutes_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payout_ledger_rec_idx ON payout_ledger (receptionist_id, created_at DESC);
