-- 084: Lost-lead recovery pipeline (price-shopper / hang-up telemetry + SMS recovery cron).
-- Run in Neon SQL Editor after 083-call-log-owner-intake-dismissed.sql.

CREATE TABLE IF NOT EXISTS lost_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  call_log_id TEXT,
  phone_number TEXT NOT NULL,
  last_quoted_price_cents INTEGER,
  failure_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lost_lead',
  vehicle_year TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  service_type TEXT,
  collected JSONB NOT NULL DEFAULT '{}'::jsonb,
  recovery_sms_sent_at TIMESTAMPTZ,
  recovery_sms_body TEXT,
  recovery_sms_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lost_leads_recovery_idx
  ON lost_leads (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS lost_leads_pending_recovery_idx
  ON lost_leads (status, created_at)
  WHERE recovery_sms_sent_at IS NULL;

COMMENT ON TABLE lost_leads IS 'Price-shopper / abrupt hang-up leads queued for AI recovery SMS.';
COMMENT ON COLUMN lost_leads.status IS 'Pipeline status — lost_lead until recovery SMS is sent.';
COMMENT ON COLUMN lost_leads.last_quoted_price_cents IS 'Last baseline quote shown on the intake sheet (cents).';
