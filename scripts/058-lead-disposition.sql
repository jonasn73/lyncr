-- 058: Operator job disposition + lead salvage pipeline.
-- Run in Neon SQL Editor after 057-company-briefing.sql.
--
-- When a receptionist logs a job (POST /api/receptionist/log-job) we stamp the captured ai_leads
-- row with its disposition. These dedicated columns mirror the same keys we also write into the
-- collected JSONB (so the dashboard works even before this migration runs); they exist mainly to
-- index the BOOKED feed + PRICE_REJECTED salvage queue.
--
--   disposition     : 'BOOKED' | 'PRICE_REJECTED' | NULL
--   dispatch_status : 'pending_review' for BOOKED jobs awaiting owner review
--   is_salvageable  : TRUE for PRICE_REJECTED leads the owner can try to rescue

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_status TEXT,
  ADD COLUMN IF NOT EXISTS is_salvageable BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_leads_disposition_idx ON ai_leads (user_id, disposition, created_at DESC);

COMMENT ON COLUMN ai_leads.disposition IS 'Operator job outcome: BOOKED or PRICE_REJECTED.';
COMMENT ON COLUMN ai_leads.dispatch_status IS 'pending_review when a BOOKED job awaits owner review.';
COMMENT ON COLUMN ai_leads.is_salvageable IS 'TRUE for PRICE_REJECTED leads surfaced in the owner Lead Salvage queue.';
