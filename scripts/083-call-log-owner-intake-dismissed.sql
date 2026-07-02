-- Owner answered-call intake sheet: stop re-prompting after dismiss or dispatch.

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS owner_intake_dismissed_at TIMESTAMPTZ;

COMMENT ON COLUMN call_logs.owner_intake_dismissed_at IS
  'When set, the owner answered-call intake sheet should not reopen for this call (any tab/device).';

CREATE INDEX IF NOT EXISTS idx_call_logs_owner_intake_dismissed
  ON call_logs (user_id, owner_intake_dismissed_at DESC)
  WHERE owner_intake_dismissed_at IS NOT NULL;
