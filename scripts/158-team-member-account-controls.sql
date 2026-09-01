-- 158: Owner-level account controls for receptionists and field technicians.
--
-- account_locked: real login block (checked at /api/auth/login and in getSessionUser(), the
-- shared server-side session resolver used by every portal layout) — distinct from
-- receptionists.is_active / field_technicians.is_active, which only ever affected call-routing
-- availability, never login.
--
-- address: neither role had one before. Kept on each role's own roster table (where name/phone
-- already live), not on `users`, since it's per-roster-membership contact info, not login info.

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_locked boolean NOT NULL DEFAULT false;
ALTER TABLE receptionists ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE field_technicians ADD COLUMN IF NOT EXISTS address text;
