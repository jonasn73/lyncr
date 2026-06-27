-- 082: Platform-admin operator onboarding — status enum, workspace assignments, backup phone, OTP.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS operator_onboarding_status TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS operator_assigned_workspaces JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_otp_code TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_otp_expires_at TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_operator_onboarding_status_check;
ALTER TABLE users ADD CONSTRAINT users_operator_onboarding_status_check
  CHECK (
    operator_onboarding_status IS NULL
    OR operator_onboarding_status IN ('PENDING_INVITE', 'DEVICE_TESTING', 'ACTIVE_READY')
  );

ALTER TABLE receptionists
  ADD COLUMN IF NOT EXISTS backup_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS assigned_workspaces JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN users.operator_onboarding_status IS
  'Receptionist provisioning lifecycle: PENDING_INVITE → DEVICE_TESTING → ACTIVE_READY.';
COMMENT ON COLUMN users.operator_assigned_workspaces IS
  'JSON array of workspace routing clearances set by platform admin at invite time.';
COMMENT ON COLUMN receptionists.backup_phone_number IS
  'Fallback PSTN number when primary cell or WebRTC is unavailable.';
COMMENT ON COLUMN receptionists.assigned_workspaces IS
  'Copied from users.operator_assigned_workspaces on activation — business profiles this operator may answer for.';
