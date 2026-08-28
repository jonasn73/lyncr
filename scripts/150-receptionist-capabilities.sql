-- Owner-configurable per-receptionist capability flags (mirrors 080-admin-notification-preferences.sql).

ALTER TABLE receptionists
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{
    "full_vehicle_key_catalog": false
  }'::jsonb;
