-- Flat Price Override — track system estimate vs negotiated booked price on jobs (ai_leads).
-- Cents columns for money math; is_price_overridden flags operator flat locks.
-- Run after 108. Also mirrored into collected JSON for older readers.

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS calculated_total_cents INTEGER;

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS final_booked_total_cents INTEGER;

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS is_price_overridden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_leads.calculated_total_cents IS
  'System-generated quote estimate in cents (before flat negotiated override).';
COMMENT ON COLUMN ai_leads.final_booked_total_cents IS
  'Actual negotiated / booked price in cents (equals calculated when not overridden).';
COMMENT ON COLUMN ai_leads.is_price_overridden IS
  'True when the operator locked a flat negotiated price that differs from the system estimate.';
