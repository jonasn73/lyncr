-- IVR auto-bypass capacity threshold (confirmed daily jobs → automation).

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS ivr_capacity_threshold INTEGER NOT NULL DEFAULT 5;

COMMENT ON COLUMN account_settings.ivr_capacity_threshold IS
  'Auto-bypass to IVR when confirmed jobs on the local day reach this count (Lines Call Flow).';
