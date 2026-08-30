-- 156: Wallet fee rows — the wallet balance never subtracted Stripe/Lyncr's own per-charge
-- cut, only reversals and (from migration 155) payouts. Run in Neon SQL Editor after
-- 155-wallet-owner-and-payouts.sql. Safe to run twice.
--
-- Combined with backfilling historical payouts (done separately, via the admin backfill
-- route — those need a live Stripe read per business, not plain SQL), this closes the gap
-- between "wallet balance" and what's actually sitting in each business's Stripe account.

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_entry_type_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_entry_type_check
    CHECK (entry_type IN ('CHARGE', 'REVERSAL', 'PAYOUT', 'FEE'));

COMMENT ON COLUMN wallet_transactions.entry_type IS
  'CHARGE = customer payment. REVERSAL = refund/dispute. PAYOUT = sent to bank. FEE = Stripe/
   Lyncr''s own cut taken at charge time. All four are signed rows in the same SUM(amount) ledger.';
