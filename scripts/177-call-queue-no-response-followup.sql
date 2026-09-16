-- Closed-hours "no response" follow-up marker. Set once the sweep has made a
-- terminal decision for this hold (customer texted that the team is unavailable
-- until the next scheduled opening) so the every-5-min cron never double-sends.
-- NULL = not yet evaluated / still inside the owner's response window.
ALTER TABLE call_queue ADD COLUMN IF NOT EXISTS no_response_followup_at timestamptz;
