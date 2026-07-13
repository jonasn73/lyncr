-- Account-level presence for one-man call routing (Available / On-Job / Closed).

CREATE TABLE IF NOT EXISTS account_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  presence_status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (presence_status IN ('AVAILABLE', 'ON_JOB', 'CLOSED')),
  -- When true, cron must not auto-clear CLOSED back to AVAILABLE.
  presence_closed_manual BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE account_settings IS
  'Per-owner account settings — presence_status drives inbound ring vs SMS capture.';
COMMENT ON COLUMN account_settings.presence_status IS
  'AVAILABLE = ring cell 15s; ON_JOB = busy IVR+SMS; CLOSED = closed IVR+SMS (no ring).';
COMMENT ON COLUMN account_settings.presence_closed_manual IS
  'True after owner taps Closed — calendar cron will not override until they leave Closed.';

-- Seed rows for existing owners (safe if re-run).
INSERT INTO account_settings (user_id, presence_status, presence_closed_manual)
SELECT id, 'AVAILABLE', false
FROM users
ON CONFLICT (user_id) DO NOTHING;
