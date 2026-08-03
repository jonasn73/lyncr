-- 124: Store walk-up / ad-hoc customer phone + name on wallet ledger rows.
-- Job-tied payments still get phone via ai_leads.caller_e164; walk-ups have job_id NULL.
-- Run in Neon SQL Editor after 123-sales-tax-defaults.sql.

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

COMMENT ON COLUMN wallet_transactions.customer_phone IS
  'E.164 customer phone for walk-up/adhoc charges (job_id NULL). Used by Collect History search + CRM LTV.';

COMMENT ON COLUMN wallet_transactions.customer_name IS
  'Optional display name captured at collect / receipt for walk-up charges.';

CREATE INDEX IF NOT EXISTS wallet_transactions_customer_phone_idx
  ON wallet_transactions (customer_phone)
  WHERE customer_phone IS NOT NULL AND customer_phone <> '';
