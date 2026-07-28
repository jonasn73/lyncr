-- Smart Busy preference — auto-suggest / engage Busy when calendar + pool are full.

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS smart_busy_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN account_settings.smart_busy_enabled IS
  'When true, Lines Smart Busy may auto-set Presence Busy (ON_JOB) when confirmed jobs today + unassigned pool exceed ivr_capacity_threshold. Owner can always tap Available.';
