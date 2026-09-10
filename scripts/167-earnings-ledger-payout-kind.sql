-- 167: Let earnings_ledger record an owner-recorded external payout (cash/Venmo/check/payroll).
-- Run in Neon SQL Editor after 166-oncall-technician-routing.sql.
--
-- Techs and receptionists had no way to receive the commission a pay plan says they're
-- owed — the wallet screen only exposes the OWNER's own Stripe Connect "send to bank"
-- payout, which moves the owner's balance, not the worker's. Neither role has their own
-- Stripe Connect account, so a real self-serve payout would mean onboarding every worker
-- through Connect KYC — a much bigger build. Instead: the owner pays the worker outside
-- the app and records it here as a negative ledger row, the same immutable-ledger pattern
-- already used for refund/timesheet corrections (reverseEarningRow). getEarningsTotal()
-- then reports "amount owed right now" for free — no new query needed.
--
-- Safe to run multiple times.

ALTER TABLE earnings_ledger DROP CONSTRAINT IF EXISTS earnings_ledger_component_kind_check;
ALTER TABLE earnings_ledger ADD CONSTRAINT earnings_ledger_component_kind_check
  CHECK (component_kind IN ('TIME', 'PER_EVENT', 'COMMISSION', 'MINIMUM_WAGE_TOPUP', 'PAYOUT'));

ALTER TABLE earnings_ledger DROP CONSTRAINT IF EXISTS earnings_ledger_source_kind_check;
ALTER TABLE earnings_ledger ADD CONSTRAINT earnings_ledger_source_kind_check
  CHECK (source_kind IN ('CALL', 'JOB', 'SHIFT', 'ADJUSTMENT', 'PAYOUT'));

COMMENT ON COLUMN earnings_ledger.component_kind IS
  'What produced this row. PAYOUT = an owner-recorded external payment settling owed commission
   (always a negative amount_cents), distinct from the pay-plan components above it.';
