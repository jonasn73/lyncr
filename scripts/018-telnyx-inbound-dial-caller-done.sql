-- Telnyx: after the first inbound <Dial> leg ends (owner/receptionist answered then hung up),
-- lyncr marks this call_sid so a repeat fetch of the voice URL (/incoming) returns <Hangup> instead of re-dialing or sending the caller to AI.
-- Run in Neon SQL Editor if callers still reach Voice AI after a live conversation (Telnyx sometimes re-posts /incoming).

CREATE TABLE IF NOT EXISTS telnyx_inbound_dial_caller_done (
  call_sid TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telnyx_inbound_dial_caller_done_created_at
  ON telnyx_inbound_dial_caller_done (created_at DESC);
