-- Future-proof users.account_role for team scaling.
-- Canonical app labels: OWNER | RECEPTIONIST | TECHNICIAN
-- Stored lowercase: owner | receptionist | field_tech | technician (alias of field_tech).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_role TEXT NOT NULL DEFAULT 'owner';

-- Any legacy null/blank rows become OWNER.
UPDATE users
SET account_role = 'owner'
WHERE account_role IS NULL OR btrim(account_role) = '';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_role_check
  CHECK (
    lower(account_role) IN (
      'owner',
      'receptionist',
      'field_tech',
      'technician'
    )
  );

COMMENT ON COLUMN users.account_role IS
  'Team role: owner (OWNER), receptionist (RECEPTIONIST), field_tech|technician (TECHNICIAN). Default owner.';
