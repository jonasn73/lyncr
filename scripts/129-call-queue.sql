-- Hold queue (Busy stay-on-the-line) — Neon migration 129
-- Run in Neon → SQL Editor after deploy. Agents cannot apply this for you.
-- Powers Lines “N waiting” + Answer bridge (Telnyx enqueue + call_queue rows).

CREATE TABLE IF NOT EXISTS call_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_control_id text NOT NULL,
  call_session_id text,
  call_log_id uuid,
  caller_e164 text,
  business_line_e164 text,
  queue_name text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  -- waiting | holding | bridging | answered | left | timed_out | sms_left
  position_hint integer,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  answered_by_user_id uuid,
  answered_at timestamptz,
  left_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_queue_call_control_id_unique UNIQUE (call_control_id)
);

CREATE INDEX IF NOT EXISTS call_queue_user_waiting
  ON call_queue (user_id, enqueued_at)
  WHERE status IN ('waiting', 'holding', 'bridging');

CREATE INDEX IF NOT EXISTS call_queue_user_enqueued
  ON call_queue (user_id, enqueued_at DESC);

-- Optional custom hold music URL (Greetings → Advanced). Env LYNCR_HOLD_MUSIC_URL still wins when set.
ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS hold_music_url text;
