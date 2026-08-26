-- ============================================================================
-- LYNCR PAY ENGINE — ALL MIGRATIONS, IN ORDER
-- ============================================================================
-- Paste this whole file into the Neon SQL Editor and run it once.
--
-- Contains, in the only order that works:
--   144-compensation-plans.sql        versioned pay plans + backfill
--   145-earnings-ledger.sql           immutable earnings rows
--   146-work-shifts.sql               the clock behind hourly pay + wage floor
--   147-worker-agreements.sql         signed terms + widen team_invites.role
--   149-lead-booking-attribution.sql  who booked a job + conservative backfill
--
-- 145 and 147 have foreign keys into compensation_plans, so 144 must come first.
-- There is no 148 (pay periods) — not built, and not needed.
--
-- Safe to run more than once: every statement is IF NOT EXISTS or idempotent.
--
-- AFTER running this, check:
--   SELECT
--     (SELECT COUNT(*) FROM receptionists) AS receptionists,
--     (SELECT COUNT(*) FROM compensation_plans WHERE effective_to IS NULL) AS live_plans,
--     (SELECT COUNT(*) FROM compensation_plans WHERE jsonb_array_length(components) = 0) AS empty_plans;
--
--   live_plans must equal receptionists.  empty_plans must be 0.
--
-- This does NOT backfill the earnings ledger. That is a separate step, run from
-- a terminal once the plans above look right:
--   npx tsx scripts/backfill-earnings-ledger.ts --dry-run
-- ============================================================================




-- ============================================================================
-- 144-compensation-plans.sql
-- ============================================================================

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


-- ============================================================================
-- 145-earnings-ledger.sql
-- ============================================================================

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


-- ============================================================================
-- 146-work-shifts.sql
-- ============================================================================

-- 146: Work shifts — the clock hourly pay and the minimum-wage floor both need.
-- Run in Neon SQL Editor after 145-earnings-ledger.sql.
--
-- Nothing tracked worked time before this. receptionists.is_active is an availability
-- toggle with no history: it says whether someone can take a call right now, and
-- forgets the moment it flips. So "how many hours did they work last week" had no
-- answer, which meant hourly pay was unbuildable and a minimum-wage floor had no
-- denominator to divide by.
--
-- Shifts open when a worker goes on duty and close when they go off. They are also
-- closed by a sweep when a worker's dashboard stops sending heartbeats, because the
-- most common way a shift ends is a closed laptop, and a shift left open overnight
-- would accrue eight hours of hourly pay nobody worked.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS work_shifts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Same polymorphic pair as compensation_plans and earnings_ledger.
  worker_role         TEXT NOT NULL CHECK (worker_role IN ('receptionist', 'field_tech')),
  receptionist_id     UUID REFERENCES receptionists(id) ON DELETE CASCADE,
  field_technician_id UUID REFERENCES field_technicians(id) ON DELETE CASCADE,
  worker_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,

  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ,

  -- AVAILABILITY: opened/closed by the on-duty toggle.
  -- MANUAL:       entered or corrected by the owner on the timesheet.
  -- AUTO_CLOSED:  ended by the heartbeat sweep, not by the worker.
  source              TEXT NOT NULL DEFAULT 'AVAILABILITY'
                        CHECK (source IN ('AVAILABILITY', 'MANUAL', 'AUTO_CLOSED')),

  -- Hours are the owner's liability, so they get to confirm them before a period
  -- locks. Unapproved shifts still show; they just are not final.
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  note                TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT work_shifts_worker_ref_check CHECK (
    (worker_role = 'receptionist' AND receptionist_id IS NOT NULL AND field_technician_id IS NULL)
    OR
    (worker_role = 'field_tech' AND field_technician_id IS NOT NULL AND receptionist_id IS NULL)
  ),

  CONSTRAINT work_shifts_window_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- One open shift per worker. Going on duty twice must not start a second clock.
CREATE UNIQUE INDEX IF NOT EXISTS work_shifts_open_uidx
  ON work_shifts (COALESCE(receptionist_id, field_technician_id))
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS work_shifts_receptionist_idx
  ON work_shifts (receptionist_id, started_at DESC)
  WHERE receptionist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_shifts_tech_idx
  ON work_shifts (field_technician_id, started_at DESC)
  WHERE field_technician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_shifts_owner_idx
  ON work_shifts (owner_user_id, started_at DESC);

-- The sweep's working set: everything still running.
CREATE INDEX IF NOT EXISTS work_shifts_open_scan_idx
  ON work_shifts (started_at)
  WHERE ended_at IS NULL;

COMMENT ON TABLE work_shifts IS
  'Clocked working time. The denominator for hourly pay and for the minimum-wage floor.';
COMMENT ON COLUMN work_shifts.source IS
  'AVAILABILITY = on-duty toggle. MANUAL = owner timesheet edit. AUTO_CLOSED = ended by the heartbeat sweep.';
COMMENT ON COLUMN work_shifts.approved_at IS
  'Set when the owner confirms these hours. Unapproved shifts still count toward pay; approval is the audit trail.';


-- ============================================================================
-- 147-worker-agreements.sql
-- ============================================================================

-- 147: Worker agreements — what someone signed, and what it said when they signed it.
-- Run in Neon SQL Editor after 146-work-shifts.sql.
--
-- Nothing recorded the terms a receptionist or tech agreed to. Pay was whatever the
-- invite happened to carry, employment type was never asked, and there was no artifact
-- either side could point at later.
--
-- The design rule here is that the agreement freezes. rendered_body holds the fully
-- interpolated text as shown at signing, and body_sha256 fingerprints it, so a later
-- change to the template or the pay plan cannot rewrite what someone agreed to. That is
-- the whole point: ESIGN and UETA ask that a signature be logically associated with the
-- specific record, and that both parties can retain and reproduce it.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS agreement_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = a Lyncr default available to every business. Set = this owner's own wording.
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('W2_OFFER', 'CONTRACTOR_AGREEMENT', 'PAY_ADDENDUM')),
  version       INTEGER NOT NULL DEFAULT 1,
  -- Markdown with {{placeholders}} — see lib/agreements/render.ts for the field list.
  body_md       TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active version per kind per owner. The partial unique index allows an owner to
-- keep older versions around for agreements already signed against them.
CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_active_uidx
  ON agreement_templates (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS worker_agreements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Set once the worker has an account. Null while the agreement is attached to an
  -- invite that has not been redeemed — someone signs before they have a login.
  worker_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  worker_role         TEXT NOT NULL CHECK (worker_role IN ('receptionist', 'field_tech')),
  receptionist_id     UUID REFERENCES receptionists(id) ON DELETE SET NULL,
  field_technician_id UUID REFERENCES field_technicians(id) ON DELETE SET NULL,

  -- team_invites.id when the agreement was created alongside an invite.
  invite_id           UUID,
  template_id         UUID REFERENCES agreement_templates(id) ON DELETE SET NULL,
  -- The plan version these terms describe.
  plan_id             UUID REFERENCES compensation_plans(id) ON DELETE SET NULL,

  employment_type     TEXT NOT NULL
                        CHECK (employment_type IN ('W2_EMPLOYEE', 'CONTRACTOR_1099')),

  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SIGNED', 'DECLINED', 'VOID')),

  -- Frozen at send time. Never regenerated — a template edit must not change what
  -- someone already agreed to.
  rendered_body       TEXT NOT NULL,
  body_sha256         TEXT NOT NULL,
  -- One-sentence pay summary, denormalized so a signed row reads on its own.
  pay_summary         TEXT NOT NULL DEFAULT '',
  -- The PayComponent[] these terms describe, carried on the agreement because someone
  -- signs before they have a roster row to hang a compensation_plan off. On signing,
  -- this is what the plan is built from — so the plan cannot say something the signed
  -- document does not.
  plan_components     JSONB NOT NULL DEFAULT '[]'::jsonb,
  pdf_blob_url        TEXT,

  signer_name         TEXT,
  signature_type      TEXT CHECK (signature_type IN ('TYPED', 'DRAWN')),
  -- The typed name, or a data: URL of the drawn path.
  signature_data      TEXT,
  -- Affirmative consent to transact electronically. Separate from the signature
  -- itself, because ESIGN treats them as two different acts.
  consent_electronic  BOOLEAN NOT NULL DEFAULT false,

  signed_at           TIMESTAMPTZ,
  signed_ip           TEXT,
  signed_user_agent   TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT worker_agreements_signed_check CHECK (
    status <> 'SIGNED'
    OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND consent_electronic = true)
  )
);

CREATE INDEX IF NOT EXISTS worker_agreements_owner_idx
  ON worker_agreements (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_agreements_worker_idx
  ON worker_agreements (worker_user_id, created_at DESC)
  WHERE worker_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS worker_agreements_invite_idx
  ON worker_agreements (invite_id)
  WHERE invite_id IS NOT NULL;

-- One pending agreement per invite: re-sending an invite must not stack up contracts.
CREATE UNIQUE INDEX IF NOT EXISTS worker_agreements_invite_pending_uidx
  ON worker_agreements (invite_id)
  WHERE invite_id IS NOT NULL AND status = 'PENDING';

COMMENT ON TABLE worker_agreements IS
  'Signed employment/contractor terms. rendered_body and body_sha256 freeze what was agreed to.';
COMMENT ON COLUMN worker_agreements.rendered_body IS
  'The fully interpolated agreement as shown at signing. Never regenerated.';
COMMENT ON COLUMN worker_agreements.body_sha256 IS
  'Fingerprint of rendered_body — proves which words were agreed to if the template later changes.';
COMMENT ON COLUMN worker_agreements.consent_electronic IS
  'Affirmative consent to transact electronically (ESIGN/UETA), recorded separately from the signature.';

-- Widen team invites so one path can carry terms for techs too. The old CHECK allowed
-- only 'receptionist', which is why field techs were invited through an entirely
-- separate stub-user flow.
ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_role_check;
ALTER TABLE team_invites
  ADD CONSTRAINT team_invites_role_check CHECK (role IN ('receptionist', 'field_tech'));


-- ============================================================================
-- 149-lead-booking-attribution.sql
-- ============================================================================

-- 149: Which call produced a job, and who was on it.
-- Run in Neon SQL Editor after 148-pay-periods.sql (or after 145 if 146–148 are not applied yet).
--
-- ai_leads records who a job was DISPATCHED to (assigned_tech_id) but nothing about who
-- BOOKED it. call_logs.routed_to_receptionist_id has the other half and the two were
-- never joined, so there was no way to pay a receptionist a commission on a job they
-- brought in — the query to find "their" jobs did not exist.
--
-- Two columns, because they answer different questions:
--
--   source_call_log_id        the fact: this job came out of that call. Immutable.
--   booked_by_receptionist_id the attribution: this person gets credit. Derived from
--                             the call, but editable — a call can be transferred, and
--                             an owner needs to be able to correct credit before a pay
--                             period is locked.
--
-- Attribution keys on the roster row, not a login user, matching compensation_plans:
-- a receptionist can be a phone contact with no portal_user_id and still be owed.
--
-- Safe to run multiple times.

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS source_call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL;

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS booked_by_receptionist_id UUID REFERENCES receptionists(id) ON DELETE SET NULL;

-- True when attribution was inferred by matching caller and time rather than recorded
-- at booking. Commission must not be paid on a guess — see the backfill note below.
ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS booking_attribution_inferred BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_leads_booked_by_idx
  ON ai_leads (booked_by_receptionist_id, created_at DESC)
  WHERE booked_by_receptionist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_leads_source_call_idx
  ON ai_leads (source_call_log_id)
  WHERE source_call_log_id IS NOT NULL;

COMMENT ON COLUMN ai_leads.source_call_log_id IS
  'The call this job was booked on. Set at intake when a call id is in hand.';
COMMENT ON COLUMN ai_leads.booked_by_receptionist_id IS
  'receptionists.id credited with booking this job. Derived from the source call, editable by the owner.';
COMMENT ON COLUMN ai_leads.booking_attribution_inferred IS
  'True when attribution came from a caller/time match rather than the booking itself. Not payable.';

-- ---------------------------------------------------------------------------
-- Backfill attribution where the link is certain.
-- ---------------------------------------------------------------------------
-- Only rows whose vapi_call_id already carries the call log id in the form the
-- intake path writes ('<callLogId>-intake-job' / '-intake'). That is a recorded
-- fact, not a guess, so these are payable.

UPDATE ai_leads l
SET source_call_log_id = cl.id,
    booked_by_receptionist_id = cl.routed_to_receptionist_id
FROM call_logs cl
WHERE l.source_call_log_id IS NULL
  AND l.vapi_call_id IS NOT NULL
  AND cl.id::text = split_part(l.vapi_call_id, '-intake', 1)
  AND cl.user_id = l.user_id;

-- Deliberately NOT backfilled: matching a lead to whoever was on a call with the same
-- number around the same time. That guess is right often enough to look convincing and
-- wrong often enough to pay the wrong person. Jobs older than this migration simply
-- have no attribution, and commission on them is not owed.
