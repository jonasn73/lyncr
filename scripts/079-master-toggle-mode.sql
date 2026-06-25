-- Platform owner quick-toggle profile (admin-only notification filtering).
-- Allowed: tech | admin | passive. Default admin.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS master_toggle_mode TEXT NOT NULL DEFAULT 'admin';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_master_toggle_mode_check;

ALTER TABLE users
  ADD CONSTRAINT users_master_toggle_mode_check
  CHECK (master_toggle_mode IN ('tech', 'admin', 'passive'));
