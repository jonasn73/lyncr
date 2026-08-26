-- 145: Immutable earnings ledger.
-- Run in Neon SQL Editor after 144-compensation-plans.sql.
--
-- Earnings are currently DERIVED ON EVERY READ (lib/receptionist-portal.ts,
-- getReceptionistPayoutMetricsForBillingCycle in lib/db.ts) from whatever rate the
-- worker has right now. That cannot survive a rate change, a refund clawback, or a
-- worker asking why this week's total differs from the screenshot they took.
--
-- One row is written when the payable event happens — a call ends, a job completes
-- and settles, a shift closes — carrying the amount AND a snapshot of the exact
-- component that produced it. Reports sum rows. Corrections are new negative rows
-- (reversed_by), never edits.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS earnings_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Same polymorphic pair as compensation_plans — exactly one is set.
  worker_role         TEXT NOT NULL CHECK (worker_role IN ('receptionist', 'field_tech')),
  receptionist_id     UUID REFERENCES receptionists(id) ON DELETE CASCADE,
  field_technician_id UUID REFERENCES field_technicians(id) ON DELETE CASCADE,
  worker_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,

  -- The plan VERSION that produced this row. Not the live plan — the one in force
  -- at earned_at. This is what makes a historical report reproducible.
  plan_id             UUID REFERENCES compensation_plans(id) ON DELETE SET NULL,
  component_kind      TEXT NOT NULL
                        CHECK (component_kind IN ('TIME', 'PER_EVENT', 'COMMISSION', 'MINIMUM_WAGE_TOPUP')),

  source_kind         TEXT NOT NULL CHECK (source_kind IN ('CALL', 'JOB', 'SHIFT', 'ADJUSTMENT')),
  -- call_logs.id | ai_leads.id | work_shifts.id | pay_periods.id. No FK: the source
  -- table varies by source_kind, and a deleted call must not erase what was earned.
  source_id           UUID,

  -- Signed. Negative = clawback (refunded job, corrected timesheet).
  amount_cents        INTEGER NOT NULL,
  -- What was measured: talk seconds, on-shift seconds, job count, commission base cents.
  quantity            NUMERIC(14, 4) NOT NULL DEFAULT 0,
  -- The single PayComponent object this row was computed from, verbatim.
  rate_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,

  earned_at           TIMESTAMPTZ NOT NULL,
  -- Stamped when a pay period is locked (148). NULL = still in an open period.
  pay_period_id       UUID,

  reversed_by         UUID REFERENCES earnings_ledger(id) ON DELETE SET NULL,
  reversal_of         UUID REFERENCES earnings_ledger(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT earnings_ledger_worker_ref_check CHECK (
    (worker_role = 'receptionist' AND receptionist_id IS NOT NULL AND field_technician_id IS NULL)
    OR
    (worker_role = 'field_tech' AND field_technician_id IS NOT NULL AND receptionist_id IS NULL)
  )
);

-- Idempotency. Telnyx call webhooks and Stripe payment webhooks both fire more than
-- once for the same event, and a retried backfill must not double-pay. Writes go
-- through ON CONFLICT DO NOTHING against this index.
CREATE UNIQUE INDEX IF NOT EXISTS earnings_ledger_dedupe_uidx
  ON earnings_ledger (
    COALESCE(receptionist_id, field_technician_id),
    source_kind,
    source_id,
    component_kind
  )
  WHERE reversed_by IS NULL AND reversal_of IS NULL AND source_id IS NOT NULL;

-- Period rollups for the portal and the owner payout view.
CREATE INDEX IF NOT EXISTS earnings_ledger_receptionist_earned_idx
  ON earnings_ledger (receptionist_id, earned_at DESC)
  WHERE receptionist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS earnings_ledger_tech_earned_idx
  ON earnings_ledger (field_technician_id, earned_at DESC)
  WHERE field_technician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS earnings_ledger_owner_earned_idx
  ON earnings_ledger (owner_user_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS earnings_ledger_period_idx
  ON earnings_ledger (pay_period_id)
  WHERE pay_period_id IS NOT NULL;

COMMENT ON TABLE earnings_ledger IS
  'Immutable per-event earnings. Never updated except to stamp pay_period_id or link a reversal.';
COMMENT ON COLUMN earnings_ledger.amount_cents IS
  'Signed USD cents. Rounded once, here — component rates are micros and are never rounded mid-calculation.';
COMMENT ON COLUMN earnings_ledger.rate_snapshot IS
  'The exact PayComponent used, so a historical row explains itself without joining a plan that may have changed.';
COMMENT ON COLUMN earnings_ledger.source_id IS
  'call_logs.id | ai_leads.id | work_shifts.id | pay_periods.id, per source_kind. Intentionally has no FK.';
