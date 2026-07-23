-- 112: Post-payment tip + customer signature slips (Collect Payment).
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS payment_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT NOT NULL,
  tip_cents INTEGER NOT NULL DEFAULT 0,
  tip_payment_intent_id TEXT,
  signature_png TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_slips_tip_nonneg CHECK (tip_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_slips_pi_uidx
  ON payment_slips (stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS payment_slips_user_created_idx
  ON payment_slips (user_id, created_at DESC);

COMMENT ON TABLE payment_slips IS
  'Tip selection + customer signature captured after Collect Payment succeeds.';
