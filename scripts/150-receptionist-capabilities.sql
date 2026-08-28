-- Owner-configurable per-receptionist capability flags (mirrors 080-admin-notification-preferences.sql).
--
-- Flags added after this file shipped are NOT backfilled on purpose: parseReceptionistCapabilities
-- reads a missing key as false, so an existing receptionist gains nothing until the owner
-- turns it on. Only the default for new rows is kept current here.

ALTER TABLE receptionists
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{
    "full_vehicle_key_catalog": false,
    "dispatching": false,
    "crm_access": false,
    "crm_edit": false,
    "scheduler": false,
    "invoicing": false,
    "invoicing_send": false,
    "owner_intake_form": false
  }'::jsonb;
