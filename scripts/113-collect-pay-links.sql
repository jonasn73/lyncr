-- 113: Short branded pay-link tokens (lyncr.app/pay/xxxxx → Stripe embedded checkout).
-- Run in Neon SQL Editor after 112-payment-slips.sql.

CREATE TABLE IF NOT EXISTS collect_pay_links (
  token TEXT PRIMARY KEY,
  stripe_session_id TEXT NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  acting_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  job_id TEXT,
  charge_cents INTEGER NOT NULL DEFAULT 0,
  business_label TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS collect_pay_links_session_uidx
  ON collect_pay_links (stripe_session_id);

CREATE INDEX IF NOT EXISTS collect_pay_links_owner_idx
  ON collect_pay_links (owner_user_id, created_at DESC);

COMMENT ON TABLE collect_pay_links IS 'Opaque short tokens for customer Collect Payment links (SMS/email).';
