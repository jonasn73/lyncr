-- Missed Call Rescue toggle — auto SMS booking link after unanswered inbound.
-- Default true preserves prior always-on rescue behavior.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS missed_call_textback_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.missed_call_textback_enabled IS
  'When true, send Missed Call Rescue SMS with /book link after unanswered / abandoned inbound calls.';
