-- Reusable owner SMS snippets (quick texts) on onboarding_profiles.
-- Used by SMS templates editor + CustomerSmsComposer one-taps.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS sms_custom_snippets JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN onboarding_profiles.sms_custom_snippets IS
  'Owner-saved reusable SMS texts: [{id, label, body}, ...]';
