-- Stripe subscription billing cycle + customer ids on onboarding_profiles.
-- Run in Neon SQL Editor after 026-onboarding-billing-method.sql.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS billing_cycle_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_cycle_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_stripe_sub
  ON onboarding_profiles(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN onboarding_profiles.billing_cycle_start IS 'Stripe subscription current_period_start';
COMMENT ON COLUMN onboarding_profiles.billing_cycle_end IS 'Stripe subscription current_period_end (next renewal)';
