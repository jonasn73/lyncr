-- 135: Customer tip on pay links + phone/email for auto receipts.
-- Run in Neon SQL Editor after 113-collect-pay-links.sql (and 134 if you are current).
--
-- What this does:
-- 1) Lets a pay link exist BEFORE Stripe Checkout is created (customer picks tip first).
-- 2) Stores the phone we texted the link to (for auto SMS receipt after pay).
-- 3) Stores tip / tax / subtotal so Checkout can charge job+tip in one amount.
-- 4) Adds customers.email so Checkout-collected email can be saved on the CRM contact.

-- Allow pay links without a Checkout session yet (tip step first).
ALTER TABLE collect_pay_links
  ALTER COLUMN stripe_session_id DROP NOT NULL;

-- Base charge pieces (service + tax). tip_cents filled when the customer confirms tip.
ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS line_summary TEXT NOT NULL DEFAULT '';

-- Phone the pay link was texted to (auto SMS receipt). Email if known at send-time.
ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL DEFAULT '';

ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT '';

-- Tech who should get wallet credit (copied into Checkout metadata when session is created).
ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS tech_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Idempotent auto-receipt after checkout.session.completed.
ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ;

-- Unique session id only when a real Checkout session exists (many NULLs allowed).
DROP INDEX IF EXISTS collect_pay_links_session_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS collect_pay_links_session_uidx
  ON collect_pay_links (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> '';

-- Backfill subtotal from charge_cents for older rows (no tip / tax split stored).
UPDATE collect_pay_links
SET subtotal_cents = charge_cents
WHERE subtotal_cents = 0 AND charge_cents > 0;

COMMENT ON COLUMN collect_pay_links.stripe_session_id IS
  'Stripe Checkout session id. NULL until the customer confirms tip and Checkout is created.';

COMMENT ON COLUMN collect_pay_links.tip_cents IS
  'Customer tip chosen on /pay/{token} before Checkout; included in charge_cents.';

COMMENT ON COLUMN collect_pay_links.customer_phone IS
  'E.164 phone the pay link SMS was sent to — used for automatic receipt SMS after pay.';

COMMENT ON COLUMN collect_pay_links.receipt_sent_at IS
  'When Lyncr auto-sent email+SMS receipt after a successful pay-link payment.';

-- CRM: store email from Checkout (or intake) on the phone-keyed customer row.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN customers.email IS
  'Optional customer email (Checkout, intake, receipts). Keyed with phone per account.';
