-- 133: Invoice history — delivery truth, invoice #, revisions for paid-outside invoices.
-- Extends job_record_invoices from 132. Safe to run multiple times.
-- Run in Neon SQL Editor after 132-job-record-invoices.sql.

-- Human-facing invoice number (INV-XXXXXXXX), stored so lists/search stay stable.
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT '';

-- Overall send outcome: pending (created, not attempted) / sent / failed / partial.
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending';

-- What the owner asked to send: email | sms | both.
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS channels_requested TEXT NOT NULL DEFAULT '';

-- Per-channel success timestamps (null = not delivered or not sent).
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMPTZ;

-- Per-channel error messages (empty string when ok / not attempted).
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS email_error TEXT NOT NULL DEFAULT '';

ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS sms_error TEXT NOT NULL DEFAULT '';

-- When we last attempted email/SMS (success or fail).
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

-- Revision chain: resend-with-edits creates a new row; old rows stay for history.
ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS parent_invoice_id UUID REFERENCES job_record_invoices(id) ON DELETE SET NULL;

ALTER TABLE job_record_invoices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill invoice numbers for rows created before this migration.
UPDATE job_record_invoices
SET invoice_number = 'INV-' || UPPER(RIGHT(REPLACE(id::text, '-', ''), 8))
WHERE invoice_number IS NULL OR invoice_number = '';

-- Soft CHECK via comment (Postgres ADD CONSTRAINT IF NOT EXISTS is awkward on older DBs).
COMMENT ON COLUMN job_record_invoices.delivery_status IS
  'pending | sent | failed | partial — email/SMS delivery outcome';

COMMENT ON COLUMN job_record_invoices.revision IS
  '1 = original; 2+ = revised copy (parent_invoice_id points at prior row)';

CREATE INDEX IF NOT EXISTS job_record_invoices_owner_invoice_number_idx
  ON job_record_invoices (owner_user_id, invoice_number);

CREATE INDEX IF NOT EXISTS job_record_invoices_owner_status_idx
  ON job_record_invoices (owner_user_id, delivery_status, created_at DESC);
