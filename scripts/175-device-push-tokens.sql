-- Device push tokens — Neon migration 175
-- Run in Neon → SQL Editor after deploy. Agents cannot apply this for you.
-- Backs Expo push notifications for the mobile app (missed/live call alerts) — one row per
-- device registration. A user can have several rows (multiple phones); a token is unique
-- across the whole table since Expo issues a fresh token per install, not per user.

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  expo_push_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_id ON device_push_tokens(user_id);

COMMENT ON TABLE device_push_tokens IS
  'Expo push tokens registered by the mobile app, one row per device install — used to deliver missed/live call notifications via Expo''s push API.';
