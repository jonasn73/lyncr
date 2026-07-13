-- Schedule blockouts — owner-defined full-day or time-range unavailability.
-- Used by Scheduler UI, public /book slots, and IVR “next open” checks.

CREATE TABLE IF NOT EXISTS schedule_blockouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  -- Calendar day in local business date form (YYYY-MM-DD), e.g. "2026-07-14".
  date TEXT NOT NULL,
  -- When true, the entire day is unavailable (start/end ignored).
  is_full_day BOOLEAN NOT NULL DEFAULT false,
  -- Optional HH:mm window when is_full_day is false (e.g. "10:30", "12:00").
  start_time TEXT,
  end_time TEXT,
  -- Optional operator label (e.g. "Doctor Appointment").
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_blockouts_date_format CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT schedule_blockouts_partial_times CHECK (
    is_full_day = true
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_schedule_blockouts_user_date
  ON schedule_blockouts (user_id, date);

CREATE INDEX IF NOT EXISTS idx_schedule_blockouts_org_date
  ON schedule_blockouts (organization_id, date)
  WHERE organization_id IS NOT NULL;

COMMENT ON TABLE schedule_blockouts IS
  'Owner calendar unavailability — full-day or time-range blocks for booking + IVR slot math.';
