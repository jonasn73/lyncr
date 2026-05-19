-- Low carrier credit alert flag (Pay tab banner after usage drops wallet below $3).
ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS low_balance_notified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN onboarding_profiles.low_balance_notified IS
  'Set true when carrier_credit falls below $3 during call usage tracking; cleared when balance is topped up.';
