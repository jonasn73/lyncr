-- ============================================
-- 051 — Per-receptionist Telnyx SIP credential id
-- ============================================
-- Run in Neon SQL Editor AFTER 050-receptionist-routing-endpoint.sql.
--
-- 050 added `sip_username`. To mint a WebRTC login token we also need the Telnyx
-- Telephony Credential **id** that the username belongs to (tokens are minted from the
-- credential id, not the username). lyncr now provisions one Telnyx telephony credential
-- per agent automatically when an admin creates a network agent (or on first "Web browser"
-- use), and stores that credential id here.
--
-- Read defensively in code (to_jsonb ->> 'sip_credential_id'), so routing/token code keeps
-- working whether or not this migration has run yet — a missing id just means "not provisioned"
-- and the receptionist safely stays on CELL (PSTN).

ALTER TABLE receptionists
  ADD COLUMN IF NOT EXISTS sip_credential_id TEXT;

COMMENT ON COLUMN receptionists.sip_credential_id IS
  'Telnyx Telephony Credential id provisioned for this agent (POST /v2/telephony_credentials). Used to mint short-lived @telnyx/webrtc login tokens. NULL = not provisioned yet.';
