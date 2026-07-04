-- 085: Manual / walk-in intake bridge — unified call_logs telemetry for dispatch manual calls.
-- Run in Neon SQL Editor after 084-lost-leads-recovery.sql.

-- Extend call_type to include owner-entered manual intake rows.
ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_call_type_check;
ALTER TABLE call_logs ADD CONSTRAINT call_logs_call_type_check
  CHECK (call_type IN ('incoming', 'outgoing', 'missed', 'voicemail', 'manual_intake'));

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS intake_source TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS intake_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS assigned_tech_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_manual_intake
  ON call_logs (user_id, created_at DESC)
  WHERE call_type = 'manual_intake';

COMMENT ON COLUMN call_logs.intake_source IS 'Origin of intake: walk_in (manual dispatch sheet), telnyx_inbound, etc.';
COMMENT ON COLUMN call_logs.intake_metadata IS 'JSON snapshot from POST /api/calls/manual (vehicle, quote, notes).';
COMMENT ON COLUMN call_logs.assigned_tech_user_id IS 'Optional field-tech users.id selected at manual intake.';
