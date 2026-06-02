-- 054: Receptionist invite stub columns on `users`.
-- Run in Neon SQL Editor after 053-invitations.sql.
--
-- Lets an admin "invite" a receptionist by email: we insert a stub users row immediately
-- (account_role = 'receptionist', invite_status = 'invited') carrying a one-time onboarding
-- token + 48h expiry. When they click the branded /onboarding?token=… link and finish setting
-- their password, the same row is flipped to invite_status = 'active'.

ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_status TEXT;

-- One pending invite per token. Partial index keeps real accounts (token NULL) out of the way.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invitation_token
  ON users (invitation_token)
  WHERE invitation_token IS NOT NULL;

COMMENT ON COLUMN users.invitation_token IS 'One-time onboarding token for an invited receptionist; cleared on activation.';
COMMENT ON COLUMN users.invitation_expires_at IS 'When the invitation_token stops being valid (typically 48h after the invite/resend).';
COMMENT ON COLUMN users.invite_status IS 'NULL = normal account; invited = stub awaiting onboarding; active = onboarded receptionist.';
