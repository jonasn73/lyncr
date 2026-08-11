-- 132: Record invoices for jobs paid outside Lyncr (Venmo, cash, etc.).
-- Powers CRM → Send invoice for reimbursement without a Stripe charge.
-- Run in Neon SQL Editor after 115-payment-receipt-tokens.sql (and 120 for garage VIN).
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS job_record_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  job_id UUID REFERENCES ai_leads(id) ON DELETE SET NULL,
  -- Charged amount in cents (e.g. 7500 = $75.00).
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  -- How the customer paid outside Stripe Checkout / Tap to Pay.
  payment_method TEXT NOT NULL DEFAULT 'VENMO'
    CHECK (payment_method IN ('VENMO', 'CASH', 'OTHER', 'EXTERNAL')),
  -- Human note on the invoice, e.g. "Paid via Venmo" / "Paid outside Lyncr".
  payment_note TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  service_label TEXT NOT NULL DEFAULT '',
  vehicle_label TEXT NOT NULL DEFAULT '',
  vehicle_vin TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Opaque token for lyncr.app/r/{token} (same public page as Stripe receipts).
  receipt_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_record_invoices_receipt_token_uidx
  ON job_record_invoices (receipt_token);

CREATE INDEX IF NOT EXISTS job_record_invoices_owner_created_idx
  ON job_record_invoices (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_record_invoices_job_idx
  ON job_record_invoices (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_record_invoices_customer_idx
  ON job_record_invoices (customer_id)
  WHERE customer_id IS NOT NULL;

COMMENT ON TABLE job_record_invoices IS
  'Paid-outside-Lyncr invoices (Venmo/cash/other) for customer reimbursement emails/SMS.';
