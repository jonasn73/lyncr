-- Deferred Google-review SMS after answered inbound calls (>60s talk).

CREATE TABLE IF NOT EXISTS pending_call_review_sms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_sid TEXT NOT NULL,
  caller_e164 TEXT NOT NULL,
  check_after TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
  skip_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (call_sid)
);

CREATE INDEX IF NOT EXISTS pending_call_review_sms_due_idx
  ON pending_call_review_sms (status, check_after);

COMMENT ON TABLE pending_call_review_sms IS
  '15-minute gate: after answered inbound >60s, send review SMS only if intake/invoice exists for the caller.';
