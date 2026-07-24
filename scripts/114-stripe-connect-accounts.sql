-- 114: Stripe Connect Express accounts for in-app Collect Payment payouts.
-- Run in Neon SQL Editor after 113-collect-pay-links.sql.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_details_submitted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_connect_account_uidx
  ON users (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

COMMENT ON COLUMN users.stripe_connect_account_id IS
  'Stripe Connect Express account id (acct_…) for Collect Payment destination / direct charges.';
COMMENT ON COLUMN users.stripe_connect_charges_enabled IS
  'True when the connected account can accept card charges.';
COMMENT ON COLUMN users.stripe_connect_payouts_enabled IS
  'True when Stripe can pay out to the linked bank.';
COMMENT ON COLUMN users.stripe_connect_details_submitted IS
  'True after the shop finished Connect onboarding forms (may still be under review).';
