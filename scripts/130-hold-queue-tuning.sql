-- Hold queue tuning (Busy stay-on-the-line) — Neon migration 130
-- Run in Neon → SQL Editor after deploy (129 must already be applied).
-- Optional per-account max wait + re-prompt interval for Greetings / Call Control.

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS hold_max_wait_secs integer;

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS hold_reprompt_secs integer;

COMMENT ON COLUMN account_settings.hold_max_wait_secs IS
  'Max Busy hold wait in seconds before one booking SMS + hangup (null = LYNCR_HOLD_MAX_WAIT_SECS / 600).';

COMMENT ON COLUMN account_settings.hold_reprompt_secs IS
  'Seconds of hold music between Busy re-prompts (null = LYNCR_HOLD_REPROMPT_MS / 45).';
