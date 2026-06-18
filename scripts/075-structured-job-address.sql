-- Structured job-site address columns on ai_leads (map precision + reporting).
-- Run in Neon SQL Editor after 074-scheduler-events.sql.

ALTER TABLE ai_leads ADD COLUMN IF NOT EXISTS job_address_full TEXT;
ALTER TABLE ai_leads ADD COLUMN IF NOT EXISTS job_address_street_number TEXT;
ALTER TABLE ai_leads ADD COLUMN IF NOT EXISTS job_address_route TEXT;
ALTER TABLE ai_leads ADD COLUMN IF NOT EXISTS job_address_locality TEXT;
ALTER TABLE ai_leads ADD COLUMN IF NOT EXISTS job_address_postal_code TEXT;
ALTER TABLE ai_leads ADD COLUMN IF NOT EXISTS job_address_admin_area TEXT;

CREATE INDEX IF NOT EXISTS ai_leads_job_address_postal_idx ON ai_leads (job_address_postal_code)
  WHERE job_address_postal_code IS NOT NULL;
