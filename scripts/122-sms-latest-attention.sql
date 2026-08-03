-- Latest / recent-activity SMS reminders for business owners.
-- When enabled, Telnyx texts the dispatch/profile phone when Latest needs attention:
--   - customer unreplied inbound SMS ("replied")
--   - finished job still needing Thanks + review SMS ("job_finished")
--   - customer submitted public /book form ("book_form") — also see 126
-- Run in Neon SQL Editor after 121-smart-busy-enabled.sql.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS sms_latest_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN onboarding_profiles.sms_latest_enabled IS
  'When true, send Telnyx SMS to the owner (dispatch/profile phone) when Latest hot actions need attention.';

-- Dedup / anti-spam log so the same customer reply or job does not spam the owner.
CREATE TABLE IF NOT EXISTS latest_attention_sms_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT latest_attention_sms_sent_event_check
    CHECK (event_type IN ('replied', 'job_finished', 'book_form'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_latest_attention_sms_dedupe
  ON latest_attention_sms_sent (user_id, event_type, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_latest_attention_sms_user_sent
  ON latest_attention_sms_sent (user_id, sent_at DESC);

COMMENT ON TABLE latest_attention_sms_sent IS
  'Tracks Latest-attention owner SMS sends for rate-limiting (replied cooldown / one per job).';
