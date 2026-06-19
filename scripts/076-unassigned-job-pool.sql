-- 076 — Unassigned Job Pool (The Hopper)
-- Indexes + backfill dispatch_status = 'unassigned_pool' for active jobs with no tech.

CREATE INDEX IF NOT EXISTS idx_ai_leads_unassigned_pool
  ON ai_leads (user_id, dispatch_status, created_at DESC)
  WHERE assigned_tech_id IS NULL
    AND (job_status IS NULL OR job_status <> 'completed');

-- Stamp existing unassigned BOOKED / PENDING_TIME jobs into the hopper.
UPDATE ai_leads
SET dispatch_status = 'unassigned_pool',
    collected = jsonb_set(
      coalesce(collected, '{}'::jsonb),
      '{dispatch_status}',
      '"unassigned_pool"'::jsonb,
      true
    )
WHERE assigned_tech_id IS NULL
  AND (job_status IS NULL OR job_status NOT IN ('completed'))
  AND (
    disposition IN ('BOOKED', 'PENDING_TIME')
    OR collected->>'disposition' IN ('BOOKED', 'PENDING_TIME')
  )
  AND (dispatch_status IS NULL OR dispatch_status IN ('pending_review', 'awaiting_time'));
