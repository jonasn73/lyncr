-- 149: Which call produced a job, and who was on it.
-- Run in Neon SQL Editor after 148-pay-periods.sql (or after 145 if 146–148 are not applied yet).
--
-- ai_leads records who a job was DISPATCHED to (assigned_tech_id) but nothing about who
-- BOOKED it. call_logs.routed_to_receptionist_id has the other half and the two were
-- never joined, so there was no way to pay a receptionist a commission on a job they
-- brought in — the query to find "their" jobs did not exist.
--
-- Two columns, because they answer different questions:
--
--   source_call_log_id        the fact: this job came out of that call. Immutable.
--   booked_by_receptionist_id the attribution: this person gets credit. Derived from
--                             the call, but editable — a call can be transferred, and
--                             an owner needs to be able to correct credit before a pay
--                             period is locked.
--
-- Attribution keys on the roster row, not a login user, matching compensation_plans:
-- a receptionist can be a phone contact with no portal_user_id and still be owed.
--
-- Safe to run multiple times.

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS source_call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL;

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS booked_by_receptionist_id UUID REFERENCES receptionists(id) ON DELETE SET NULL;

-- True when attribution was inferred by matching caller and time rather than recorded
-- at booking. Commission must not be paid on a guess — see the backfill note below.
ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS booking_attribution_inferred BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_leads_booked_by_idx
  ON ai_leads (booked_by_receptionist_id, created_at DESC)
  WHERE booked_by_receptionist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_leads_source_call_idx
  ON ai_leads (source_call_log_id)
  WHERE source_call_log_id IS NOT NULL;

COMMENT ON COLUMN ai_leads.source_call_log_id IS
  'The call this job was booked on. Set at intake when a call id is in hand.';
COMMENT ON COLUMN ai_leads.booked_by_receptionist_id IS
  'receptionists.id credited with booking this job. Derived from the source call, editable by the owner.';
COMMENT ON COLUMN ai_leads.booking_attribution_inferred IS
  'True when attribution came from a caller/time match rather than the booking itself. Not payable.';

-- ---------------------------------------------------------------------------
-- Backfill attribution where the link is certain.
-- ---------------------------------------------------------------------------
-- Only rows whose vapi_call_id already carries the call log id in the form the
-- intake path writes ('<callLogId>-intake-job' / '-intake'). That is a recorded
-- fact, not a guess, so these are payable.

UPDATE ai_leads l
SET source_call_log_id = cl.id,
    booked_by_receptionist_id = cl.routed_to_receptionist_id
FROM call_logs cl
WHERE l.source_call_log_id IS NULL
  AND l.vapi_call_id IS NOT NULL
  AND cl.id::text = split_part(l.vapi_call_id, '-intake', 1)
  AND cl.user_id = l.user_id;

-- Deliberately NOT backfilled: matching a lead to whoever was on a call with the same
-- number around the same time. That guess is right often enough to look convincing and
-- wrong often enough to pay the wrong person. Jobs older than this migration simply
-- have no attribution, and commission on them is not owed.
