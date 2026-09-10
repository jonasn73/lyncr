-- 168: Track whether a missed-call quick SMS is awaiting/received a customer reply,
-- so Activity can surface "customer replied — call back?" instead of going silent
-- after the text is sent. Run in Neon SQL Editor after 167-earnings-ledger-payout-kind.sql.

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sms_follow_up_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_sms_follow_up_status_check;
ALTER TABLE call_logs ADD CONSTRAINT call_logs_sms_follow_up_status_check
  CHECK (sms_follow_up_status IN ('none', 'awaiting_reply', 'replied', 'resolved'));
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sms_follow_up_last_at TIMESTAMPTZ;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sms_follow_up_preview TEXT;

CREATE INDEX IF NOT EXISTS idx_call_logs_sms_follow_up_open
  ON call_logs (user_id, sms_follow_up_status, sms_follow_up_last_at DESC)
  WHERE sms_follow_up_status IN ('awaiting_reply', 'replied');

-- Traceability: which call a given outbound/inbound SMS thread message belongs to.
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_call_log
  ON sms_messages (call_log_id)
  WHERE call_log_id IS NOT NULL;

COMMENT ON COLUMN call_logs.sms_follow_up_status IS
  'none = no missed-call text sent. awaiting_reply = quick SMS sent, no reply yet. replied = customer texted back, needs a decision. resolved = owner handled it (booked, called back, or dismissed).';
