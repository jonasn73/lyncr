-- ============================================
-- On-call field technician routing (CLOSED presence)
-- ============================================
-- Lets an owner designate one field_technicians row to ring during CLOSED
-- (after-hours) presence instead of the busy-backup receptionist / hold automation.
-- Safe to re-run. NULL = feature off (default); no existing rows are affected.

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS oncall_technician_id UUID REFERENCES field_technicians(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS routing_config_oncall_tech_idx ON routing_config (oncall_technician_id);

COMMENT ON COLUMN routing_config.oncall_technician_id IS
  'field_technicians.id designated to ring during CLOSED presence instead of busy-backup receptionist/automation. NULL = feature off. MVP: single tech, not a rotation.';
