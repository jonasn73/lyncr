-- Persist inbound Call Control ID → outbound (cell) dial leg so caller hangup
-- can cancel phantom ringing across Vercel serverless instances.
CREATE TABLE IF NOT EXISTS telnyx_call_leg_links (
  inbound_call_control_id TEXT PRIMARY KEY,
  outbound_call_control_id TEXT NOT NULL,
  call_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telnyx_call_leg_links_created_at_idx
  ON telnyx_call_leg_links (created_at);
