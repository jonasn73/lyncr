-- ============================================
-- 052 — Invite delivery channel (EMAIL / SMS) for receptionist onboarding
-- ============================================
-- Run in Neon SQL Editor AFTER 051-receptionist-sip-credential.sql.
--
-- Extends the existing `team_invites` table (041) so an admin can invite a receptionist by
-- EMAIL or SMS. The invitee completes their own profile at /register?token=…, so the name is
-- collected at registration rather than at invite time — email/first_name become optional.
--
-- Read defensively in code (parse tolerates missing columns), so the existing email-invite flow
-- keeps working before this migration is applied.

-- Name + email are now optional (SMS invites have only a phone number until the invitee registers).
ALTER TABLE team_invites ALTER COLUMN email DROP NOT NULL;
ALTER TABLE team_invites ALTER COLUMN first_name DROP NOT NULL;

-- Delivery channel: how the invite link was sent.
ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_channel_check;
ALTER TABLE team_invites ADD CONSTRAINT team_invites_channel_check CHECK (channel IN ('EMAIL', 'SMS'));

-- Target phone number for SMS invites (pre-fills the registration form).
ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS phone TEXT;

-- Explicit lifecycle status (kept in sync with accepted_at / expires_at by the app).
ALTER TABLE team_invites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_status_check;
ALTER TABLE team_invites ADD CONSTRAINT team_invites_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED'));

COMMENT ON COLUMN team_invites.channel IS 'How the invite link was delivered: EMAIL (Resend) or SMS (Telnyx).';
COMMENT ON COLUMN team_invites.phone IS 'Target cell number for SMS invites; pre-fills /register. NULL for email invites.';
COMMENT ON COLUMN team_invites.status IS 'PENDING (default), ACCEPTED (redeemed at /register), or EXPIRED.';
