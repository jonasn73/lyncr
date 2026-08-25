-- 144: Versioned compensation plans for receptionists and field techs.
-- Run in Neon SQL Editor after 143-user-shop-address.sql.
--
-- Replaces the two-mode pay model on `receptionists` (pay_mode / rate_per_minute /
-- flat_rate_usd, scripts/039) with a plan that carries 1..n pay COMPONENTS, so
-- "per second PLUS commission on completed jobs" is two components on one plan
-- rather than a new enum value. Field techs had no pay columns at all; they get
-- the same table.
--
-- Two properties matter more than the shape:
--
--   1. Plans are VERSIONED. A rate change closes the current row (effective_to)
--      and opens a new one. Nothing is edited in place. Before this, earnings were
--      recomputed on every read from the CURRENT rate, so raising someone's rate
--      silently rewrote what last month's report said they had earned.
--
--   2. Rates are stored in MICROS (millionths of a dollar), not NUMERIC dollars.
--      $0.25/min is $0.004166.../sec, which receptionists.rate_per_minute
--      NUMERIC(6,4) truncates to 0.0042 — a 0.8% overpay on every billed second.
--
-- The old receptionists columns are left in place and still read as a fallback for
-- workers who have no plan yet. See lib/compensation/plan-schema.ts.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS compensation_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The business that owes the money.
  owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Exactly one of these is set — the roster row, not the login user, is the stable
  -- identity. A receptionist may be a phone contact with no portal_user_id and still
  -- be owed money, so the plan cannot hang off users.id.
  worker_role         TEXT NOT NULL CHECK (worker_role IN ('receptionist', 'field_tech')),
  receptionist_id     UUID REFERENCES receptionists(id) ON DELETE CASCADE,
  field_technician_id UUID REFERENCES field_technicians(id) ON DELETE CASCADE,

  -- The worker's login, when they have one. Convenience for portal queries only.
  worker_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,

  -- W2_EMPLOYEE | CONTRACTOR_1099 | UNSPECIFIED.
  -- UNSPECIFIED exists so backfilled rows stay truthful: nobody classified these
  -- workers, and Lyncr must not invent an answer. The plan editor requires a real
  -- value before a plan can be signed.
  employment_type     TEXT NOT NULL DEFAULT 'UNSPECIFIED'
                        CHECK (employment_type IN ('W2_EMPLOYEE', 'CONTRACTOR_1099', 'UNSPECIFIED')),

  -- PayComponent[] — see lib/compensation/plan-schema.ts for the parsed union.
  components          JSONB NOT NULL DEFAULT '[]'::jsonb,
  currency            TEXT NOT NULL DEFAULT 'USD',

  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to        TIMESTAMPTZ,                                    -- NULL = the live plan
  superseded_by       UUID REFERENCES compensation_plans(id) ON DELETE SET NULL,

  -- worker_agreements.id backing this version (147). Nullable until contracts ship.
  agreement_id        UUID,

  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- worker_role and the two roster columns must agree, and exactly one may be set.
  CONSTRAINT compensation_plans_worker_ref_check CHECK (
    (worker_role = 'receptionist' AND receptionist_id IS NOT NULL AND field_technician_id IS NULL)
    OR
    (worker_role = 'field_tech' AND field_technician_id IS NOT NULL AND receptionist_id IS NULL)
  ),

  CONSTRAINT compensation_plans_window_check CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

-- One live plan per worker. Superseding must close the old row first.
CREATE UNIQUE INDEX IF NOT EXISTS compensation_plans_live_receptionist_uidx
  ON compensation_plans (receptionist_id)
  WHERE effective_to IS NULL AND receptionist_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS compensation_plans_live_tech_uidx
  ON compensation_plans (field_technician_id)
  WHERE effective_to IS NULL AND field_technician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS compensation_plans_owner_idx
  ON compensation_plans (owner_user_id, worker_role, effective_from DESC);

-- Point lookup for "which plan was in force when this call ended".
CREATE INDEX IF NOT EXISTS compensation_plans_receptionist_window_idx
  ON compensation_plans (receptionist_id, effective_from DESC)
  WHERE receptionist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS compensation_plans_tech_window_idx
  ON compensation_plans (field_technician_id, effective_from DESC)
  WHERE field_technician_id IS NOT NULL;

COMMENT ON TABLE compensation_plans IS
  'Versioned pay plans. One live row per worker (effective_to IS NULL); rate changes supersede rather than update.';
COMMENT ON COLUMN compensation_plans.components IS
  'PayComponent[] JSONB. Rates in micros (millionths of a dollar), commission in basis points.';
COMMENT ON COLUMN compensation_plans.employment_type IS
  'W2_EMPLOYEE | CONTRACTOR_1099 | UNSPECIFIED. The owner classifies the worker — never defaulted to a real value.';
COMMENT ON COLUMN compensation_plans.effective_to IS
  'NULL = live. Set when superseded; earnings already written keep pointing at the version that produced them.';

-- ---------------------------------------------------------------------------
-- Backfill: one plan per existing roster row, reproducing today's pay exactly.
-- ---------------------------------------------------------------------------
-- FLAT_RATE  -> PER_EVENT on ANSWERED_CALL
-- PER_MINUTE -> TIME / MINUTE on TALK
--
-- Both carry min_billable_seconds = 20 explicitly, because that floor is currently
-- a hard-coded constant (MIN_BILLABLE_TALK_SECONDS in lib/receptionist-pay.ts) that
-- applies to both modes. New plans created in the editor get the schema default
-- instead — 0 for TIME, since per-second pay is already proportional and does not
-- need a cliff at 20 seconds.

INSERT INTO compensation_plans (
  owner_user_id, worker_role, receptionist_id, worker_user_id,
  employment_type, components, effective_from
)
SELECT
  r.user_id,
  'receptionist',
  r.id,
  r.portal_user_id,
  'UNSPECIFIED',
  CASE
    WHEN upper(COALESCE(r.pay_mode, 'PER_MINUTE')) = 'FLAT_RATE' THEN
      jsonb_build_array(jsonb_build_object(
        'kind', 'PER_EVENT',
        'event', 'ANSWERED_CALL',
        'amount_micros', round(COALESCE(r.flat_rate_usd, 2.50) * 1000000)::bigint,
        'min_billable_seconds', 20
      ))
    ELSE
      jsonb_build_array(jsonb_build_object(
        'kind', 'TIME',
        'unit', 'MINUTE',
        'basis', 'TALK',
        'rate_micros', round(COALESCE(r.rate_per_minute, 0.25) * 1000000)::bigint,
        'min_billable_seconds', 20
      ))
  END,
  COALESCE(r.created_at, now())
FROM receptionists r
WHERE NOT EXISTS (
  SELECT 1 FROM compensation_plans p
  WHERE p.receptionist_id = r.id AND p.effective_to IS NULL
);

-- Field techs had no pay columns, so there is nothing to reproduce. They are
-- deliberately left without a plan: lib/job-payments.ts still falls back to the
-- global TECH_JOB_COMMISSION_RATE env var until phase 4 replaces both call sites,
-- and inventing a rate here would start paying people a number nobody chose.

COMMENT ON COLUMN receptionists.pay_mode IS
  'SUPERSEDED by compensation_plans (144). Read only as a fallback for rows with no plan.';
COMMENT ON COLUMN receptionists.rate_per_minute IS
  'SUPERSEDED by compensation_plans (144). Read only as a fallback for rows with no plan.';
COMMENT ON COLUMN receptionists.flat_rate_usd IS
  'SUPERSEDED by compensation_plans (144). Read only as a fallback for rows with no plan.';
