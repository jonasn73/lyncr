-- 154: Wallet reversals — refunds and disputes take money back out.
-- Run in Neon SQL Editor after 153-backfill-existing-staff-grants.sql. Safe to run twice.
--
-- A reversal is a NEW row with a negative amount, not an edit of the original charge:
--   * partial refunds work (a status flag on the original cannot express "$40 of $120 back")
--   * the history stays intact — you can still see what was collected and what came back
--   * every total in the app is already SUM(amount), so a negative row just lowers it
--
-- Idempotency comes free from the existing unique index on stripe_payment_intent_id
-- (migration 116): a reversal row stores the Stripe refund / dispute id there, which is
-- unique per event, so a webhook delivered twice loses the insert race and changes nothing.

-- Link a reversal back to the charge it undoes.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS reverses_transaction_id UUID
    REFERENCES wallet_transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN wallet_transactions.reverses_transaction_id IS
  'Set on negative rows: the original charge row this reversal takes back.';

-- REFUND | DISPUTE | DISPUTE_WON — why money moved back, for the wallet list label.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT
    CHECK (reversal_reason IS NULL OR reversal_reason IN ('REFUND', 'DISPUTE', 'DISPUTE_WON'));

COMMENT ON COLUMN wallet_transactions.reversal_reason IS
  'Non-null only on reversal rows. DISPUTE_WON is a positive re-credit after winning.';

CREATE INDEX IF NOT EXISTS wallet_transactions_reverses_idx
  ON wallet_transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

-- The amount column already documents itself as signed, but it predates any negative writer.
COMMENT ON COLUMN wallet_transactions.amount IS
  'Signed USD. Positive = collected. Negative = reversed (refund / dispute), see reversal_reason.';
