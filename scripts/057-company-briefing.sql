-- 057: Company briefing fields for the receptionist web-phone screen-pop.
-- Run in Neon SQL Editor after 056-dispatch-alert-prefs.sql.
--
-- business_hours / service_rules back the operator "cheat-sheet" card. business_instructions is
-- already stored on onboarding_profiles.routing_instructions (scripts/055) and reused as-is.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS business_hours TEXT,
  ADD COLUMN IF NOT EXISTS service_rules TEXT;

COMMENT ON COLUMN onboarding_profiles.business_hours IS 'Owner-set hours shown on the operator company briefing card.';
COMMENT ON COLUMN onboarding_profiles.service_rules IS 'Owner-set dispatch rates / policies / service boundaries shown on the operator briefing card.';
