-- Secure public booking invite tokens for IVR / Missed Call Rescue SMS links.
-- URL shape: https://lyncr.app/book/<id>

CREATE TABLE IF NOT EXISTS booking_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_line TEXT NOT NULL,
  caller_phone TEXT,
  source TEXT NOT NULL DEFAULT 'ivr',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS booking_invites_owner_created_idx
  ON booking_invites (owner_user_id, created_at DESC);

COMMENT ON TABLE booking_invites IS
  'Opaque tracking tokens for lyncr.app/book/[id] SMS links (IVR digit 1 + busy fallback).';
