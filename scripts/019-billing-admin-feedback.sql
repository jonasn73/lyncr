-- ============================================
-- 019 — Billing balance, plans, platform admin, ledger, feedback
-- ============================================
-- HOW TO RUN IN NEON (SQL Editor):
--   1. Open THIS file in your editor (or GitHub), select ALL lines, copy.
--   2. Paste into Neon SQL Editor — do NOT paste the path "scripts/019-..." alone;
--      that is a file name, not SQL, and causes: syntax error at or near "scripts".
-- Run in Neon after prior migrations. Adds prepaid-style credit (cents) on users,
-- optional platform admin flag, append-only billing ledger, and user feedback rows.

ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_balance_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_plan TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.credit_balance_cents IS 'Prepaid balance in USD cents; decremented by usage jobs (future) or adjusted via billing_ledger.';
COMMENT ON COLUMN users.billing_plan IS 'Marketing / entitlements key: trial | starter | growth | enterprise (app validates).';
COMMENT ON COLUMN users.is_platform_admin IS 'When true, user may access /admin (also allow-list via LYNCR_ADMIN_EMAILS).';

CREATE TABLE IF NOT EXISTS billing_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  reason TEXT NOT NULL,
  reference TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_user_created ON billing_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feedback_submissions_category_check CHECK (category IN ('issue', 'feature', 'billing', 'other')),
  CONSTRAINT feedback_submissions_status_check CHECK (status IN ('open', 'triaged', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user ON feedback_submissions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status ON feedback_submissions(status, created_at DESC);
