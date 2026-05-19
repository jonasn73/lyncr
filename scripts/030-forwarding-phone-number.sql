-- Personal cell routing target for audio diagnostics dial-out (onboarding_profiles = app "profiles" row).
ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS forwarding_phone_number TEXT;

COMMENT ON COLUMN onboarding_profiles.forwarding_phone_number IS
  'E.164 personal cell for outbound audio diagnostics and routing handoff; mirrors users.phone when set in Settings.';

-- Backfill from users.phone where profile exists but forwarding is empty.
UPDATE onboarding_profiles op
SET forwarding_phone_number = u.phone
FROM users u
WHERE u.id = op.user_id
  AND u.phone IS NOT NULL
  AND trim(u.phone) <> ''
  AND (op.forwarding_phone_number IS NULL OR trim(op.forwarding_phone_number) = '');
