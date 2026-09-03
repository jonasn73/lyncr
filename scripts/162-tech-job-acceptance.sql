-- 162: Tech job acceptance (ack only) + deferred remote-payment marker.
-- Run in Neon SQL Editor after 149-lead-booking-attribution.sql.
--
-- accepted_at: the tech tapped Accept (or replied to the dispatch SMS). Acknowledgment
-- only — it never gates Start Route or anything else, it's just a timestamp so the owner
-- can see the job was seen. Any status progression the tech makes also stamps it, so a
-- tech who jumps straight to Start Route isn't forced through a redundant tap.
--
-- payment_pending_remote: set when a tech taps "Office will collect" on a card job instead
-- of running a card himself. Job stays job_status = 'work_complete' — this is a UI/notify
-- flag layered on top, not a new status, so nothing else that reads job_status needs to change.
--
-- Safe to run multiple times.

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL;

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS payment_pending_remote BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_leads.accepted_at IS
  'When the assigned tech acknowledged the job (tap or SMS reply). Acknowledgment only — never gates anything.';
COMMENT ON COLUMN ai_leads.payment_pending_remote IS
  'True while a card job is waiting on the office to collect payment remotely (call-in or pay link) instead of the tech running a card on site.';
