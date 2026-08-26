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
