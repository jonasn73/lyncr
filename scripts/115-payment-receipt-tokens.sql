-- 115: Short invoice / receipt tokens (lyncr.app/r/xxxxx).
-- Run in Neon SQL Editor after 112–114.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS payment_receipt_tokens (
  token TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipt_tokens_pi_uidx
  ON payment_receipt_tokens (stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS payment_receipt_tokens_owner_idx
  ON payment_receipt_tokens (owner_user_id, created_at DESC);

COMMENT ON TABLE payment_receipt_tokens IS
  'Opaque short tokens for customer invoice links in SMS/email (lyncr.app/r/{token}).';
