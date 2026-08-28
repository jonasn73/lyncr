-- Platform-admin ceiling per business account (mirrors 150-receptionist-capabilities.sql).
--
-- Empty by default, and an absent key parses as GRANTED — see lib/platform-account-grants.ts.
-- An account only loses something once an admin explicitly writes false, so shipping this
-- column changes nothing for anyone until the admin console is used.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS platform_grants JSONB NOT NULL DEFAULT '{}'::jsonb;
