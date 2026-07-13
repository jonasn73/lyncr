-- Delayed job-photo alerts: ticket status on tokens + operator dashboard heartbeats.

-- awaiting_photos = SMS link sent, waiting on customer
-- pending_info    = call ended / intake parked waiting on photos
-- resolved        = operator acknowledged or alert cycle finished
ALTER TABLE job_photo_tokens
  ADD COLUMN IF NOT EXISTS ticket_status TEXT NOT NULL DEFAULT 'awaiting_photos';

ALTER TABLE job_photo_tokens
  DROP CONSTRAINT IF EXISTS job_photo_tokens_ticket_status_check;

ALTER TABLE job_photo_tokens
  ADD CONSTRAINT job_photo_tokens_ticket_status_check
  CHECK (ticket_status IN ('awaiting_photos', 'pending_info', 'resolved'));

ALTER TABLE job_photo_tokens
  ADD COLUMN IF NOT EXISTS operator_alert_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN job_photo_tokens.ticket_status IS
  'Intake ticket wait state for photo requests (Pending Info / Awaiting Photos).';

-- Last time the owner dashboard tab was visibly open (session activity gate for SMS).
CREATE TABLE IF NOT EXISTS operator_dashboard_heartbeats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE operator_dashboard_heartbeats IS
  'Owner/receptionist dashboard tab heartbeats — inactive sessions trigger photo-upload SMS alerts.';
