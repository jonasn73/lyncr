-- 136: Persist last-known Neon/Telnyx health so cron alerts do not SMS every tick.
-- Run in Neon SQL Editor after 135-collect-pay-links-tip-receipt.sql (or whenever you are current).
-- See scripts/MIGRATE-ALL.md.

-- One row per probe (neon / telnyx). Cron upserts status + last alert times.
CREATE TABLE IF NOT EXISTS platform_health_snapshots (
  check_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_error_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_alerted_at TIMESTAMPTZ,
  last_recovery_alerted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_health_snapshots_check_name_chk
    CHECK (check_name IN ('neon', 'telnyx')),
  CONSTRAINT platform_health_snapshots_status_chk
    CHECK (status IN ('ok', 'error', 'unconfigured'))
);

COMMENT ON TABLE platform_health_snapshots IS
  'Last Neon/Telnyx health ping + last SMS/email alert times for /api/cron/platform-health.';

-- New platform-admin toggle: text me when Neon or Telnyx goes red (default on).
-- Existing JSON keys stay; parseAdminNotificationPreferences fills this key if missing.
UPDATE users
SET admin_notification_preferences =
  COALESCE(admin_notification_preferences, '{}'::jsonb) || '{"sms_platform_health": true}'::jsonb
WHERE admin_notification_preferences IS NOT NULL
  AND NOT (admin_notification_preferences ? 'sms_platform_health');
