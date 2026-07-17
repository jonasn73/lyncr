-- Specialty / dealer-only flag on key_inventory + affiliate locksmith partners for out-of-stock fallback.
-- Run in Neon → SQL Editor after 105. See scripts/MIGRATE-ALL.md.

-- True when the blank/fob is Specialty / Dealer-Only (not stocked for same-day mobile jobs).
ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS is_specialty BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN key_inventory.is_specialty IS
  'Specialty / Dealer-Only — show Out of Stock alternative solutions even if quantity > 0.';

-- Pre-configured partner locksmiths for "Partner Dispatch" lead referrals.
CREATE TABLE IF NOT EXISTS affiliate_locksmiths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  -- Optional webhook for automated dispatch payloads (JSON POST).
  webhook_url TEXT,
  -- Default referral commission in cents (shown as "$X Commission Pending").
  commission_cents INTEGER NOT NULL DEFAULT 5000 CHECK (commission_cents >= 0),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_locksmiths_user_id_idx
  ON affiliate_locksmiths (user_id);

CREATE INDEX IF NOT EXISTS affiliate_locksmiths_org_id_idx
  ON affiliate_locksmiths (organization_id);

CREATE INDEX IF NOT EXISTS affiliate_locksmiths_active_idx
  ON affiliate_locksmiths (user_id, active, sort_order);

COMMENT ON TABLE affiliate_locksmiths IS
  'Affiliate locksmith partners for out-of-stock / specialty Partner Dispatch referrals.';
