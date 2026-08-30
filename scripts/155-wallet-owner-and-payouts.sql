-- 155: Owner-direct ledger balance — attribute every row to the business it belongs to,
-- and let a bank payout write its own ledger row so it subtracts immediately.
-- Run in Neon SQL Editor after 154-wallet-reversals.sql. Safe to run twice.
--
-- Today the owner's collected total is computed by joining every row through its job
-- (ai_leads.user_id) — a payment whose job later gets deleted or reassigned becomes invisible
-- to the owner even though the money is real. owner_user_id makes ownership a fact stored on
-- the row itself, set at write time, so the total becomes a direct SUM with no join.
--
-- payment_method was scoped to how the CUSTOMER paid (card / cash / tap) — a payout to the
-- bank isn't a customer payment method, so it needs its own lane in the same signed ledger.

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN wallet_transactions.owner_user_id IS
  'The business this money belongs to, set at write time. Direct SUM(amount) WHERE owner_user_id
   = X is the owner''s true wallet balance — no join through job_id required.';

-- Backfill from the existing job-owner join. Rows whose job_id points at a deleted/reassigned
-- lead are left NULL on purpose — we cannot honestly reconstruct their owner from job data
-- alone, and guessing would risk attributing money to the wrong business.
UPDATE wallet_transactions wt
SET owner_user_id = al.user_id
FROM ai_leads al
WHERE wt.job_id = al.id AND wt.owner_user_id IS NULL;

-- Walk-up / ad-hoc charges (no job) already stamp user_id with the owner directly.
UPDATE wallet_transactions
SET owner_user_id = user_id
WHERE job_id IS NULL AND owner_user_id IS NULL;

CREATE INDEX IF NOT EXISTS wallet_transactions_owner_status_idx
  ON wallet_transactions (owner_user_id, status)
  WHERE owner_user_id IS NOT NULL;

-- CHARGE | REVERSAL | PAYOUT — what kind of ledger row this is, independent of payment_method.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'CHARGE'
    CHECK (entry_type IN ('CHARGE', 'REVERSAL', 'PAYOUT'));

COMMENT ON COLUMN wallet_transactions.entry_type IS
  'CHARGE = customer payment. REVERSAL = refund/dispute (see reversal_reason). PAYOUT = sent to
   bank. All three are signed rows in the same SUM(amount) ledger.';

UPDATE wallet_transactions
SET entry_type = 'REVERSAL'
WHERE reversal_reason IS NOT NULL AND entry_type = 'CHARGE';

-- Let a payout row use payment_method = 'PAYOUT' (it isn't a customer payment method, but it's
-- the same signed ledger and this keeps payment_method NOT NULL rather than adding a nullable
-- carve-out just for one entry_type).
ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_payment_method_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_payment_method_check
    CHECK (payment_method IN ('TAP_TO_PAY', 'MANUAL_CARD', 'CASH', 'PAYOUT'));
