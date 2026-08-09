-- Short public codes for booking SMS links (lyncr.app/b/XXXX).
-- UUID /book/[id] URLs keep working; new invites get a short_code when possible.

ALTER TABLE booking_invites
  ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Unique when present (legacy UUID-only rows stay NULL until next send).
CREATE UNIQUE INDEX IF NOT EXISTS booking_invites_short_code_uidx
  ON booking_invites (short_code)
  WHERE short_code IS NOT NULL;

-- Caller lookback for same-day invite reuse / SMS dedupe.
CREATE INDEX IF NOT EXISTS booking_invites_owner_caller_created_idx
  ON booking_invites (owner_user_id, caller_phone, created_at DESC);

COMMENT ON COLUMN booking_invites.short_code IS
  'Opaque short token for lyncr.app/b/{code}; UUID id still resolves at /book/{id}.';
