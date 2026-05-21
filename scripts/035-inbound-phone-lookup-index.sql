-- Faster inbound DID lookup for Telnyx voice webhooks (match phone_numbers by E.164 / digits).
-- Run in Neon SQL Editor after prior migrations (see scripts/MIGRATE-ALL.md step 35).

CREATE INDEX IF NOT EXISTS idx_phone_numbers_active_number
  ON phone_numbers (number)
  WHERE status = 'active';

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS number_digits text
  GENERATED ALWAYS AS (regexp_replace(number, '\D', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_phone_numbers_active_digits
  ON phone_numbers (number_digits)
  WHERE status = 'active';
