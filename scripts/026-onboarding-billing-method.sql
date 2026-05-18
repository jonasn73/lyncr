-- Onboarding billing method flag (card collected during signup billing step).
-- Run in Neon SQL Editor if dashboard "Activate Line Now" cannot detect saved payment.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS has_billing_method BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_billing ON onboarding_profiles(has_billing_method);

COMMENT ON COLUMN onboarding_profiles.has_billing_method IS 'True when user submitted payment details during onboarding (or dashboard activate modal).';
