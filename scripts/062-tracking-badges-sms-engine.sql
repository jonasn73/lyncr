-- 062: Technician tracking + performance badges + automated customer SMS engine.
-- Run in Neon SQL Editor after 061-field-technicians.sql.

-- 1) Tech live location, status, and earned performance badges (on the tech's users row).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS current_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS tech_status TEXT,                       -- idle | en_route | on_site
  ADD COLUMN IF NOT EXISTS earned_badges JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN users.tech_status IS 'Field tech live status: idle | en_route | on_site.';
COMMENT ON COLUMN users.earned_badges IS 'Array of earned performance badge ids (computed from job metrics).';

-- 2) Owner automated-SMS settings (toggles + editable templates + review link) on onboarding_profiles.
ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS sms_booking_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_route_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_review_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_booking_template TEXT,
  ADD COLUMN IF NOT EXISTS sms_route_template TEXT,
  ADD COLUMN IF NOT EXISTS sms_review_template TEXT,
  ADD COLUMN IF NOT EXISTS google_review_url TEXT;

-- 3) Scheduled outbound texts (e.g. the post-job review request that drops 15 min after completion).
CREATE TABLE IF NOT EXISTS scheduled_sms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID,
  to_e164 TEXT NOT NULL,
  body TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'review',   -- booking | route | review
  send_after TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed | canceled
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS scheduled_sms_due_idx ON scheduled_sms (status, send_after);
