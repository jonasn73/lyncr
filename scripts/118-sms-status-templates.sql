-- Editable customer status SMS (late / arrived / paused) on onboarding_profiles.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS sms_status_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN onboarding_profiles.sms_status_templates IS
  'Owner status SMS copy: { late, arrived, paused_wait, paused_parts } strings with {{tags}}';
