-- 111: Technician wallet + job payment transactions.
-- Run in Neon SQL Editor after 110-ti-supplier-catalog.sql.
--
-- This project uses Neon SQL (not Prisma). Equivalent of a Prisma Transaction model
-- linked to User (technician) + Job (ai_leads), plus users.balance for available wallet funds.

-- 1) Active wallet balance on the technician's login user.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS balance NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.balance IS
  'Field-tech wallet available balance (USD). Incremented when wallet_transactions settle to COMPLETED.';

-- 2) Per-job payment transactions for the tech earnings dashboard.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Technician login user (users.id, account_role = field_tech).
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Booked job (ai_leads.id).
  job_id UUID REFERENCES ai_leads(id) ON DELETE SET NULL,
  -- Signed amount in USD (positive = earnings credited to the tech).
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- PENDING | COMPLETED | FAILED
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  -- TAP_TO_PAY | MANUAL_CARD | CASH
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('TAP_TO_PAY', 'MANUAL_CARD', 'CASH')),
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
  ON wallet_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_transactions_job_idx
  ON wallet_transactions (job_id);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_status_idx
  ON wallet_transactions (user_id, status);

COMMENT ON TABLE wallet_transactions IS
  'Technician wallet ledger rows from on-site job payments (Key Details → invoice collect).';
