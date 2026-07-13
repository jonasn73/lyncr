-- Live GPS share tokens for intake "Request Live GPS" SMS links (/locate?c=…).

CREATE TABLE IF NOT EXISTS live_gps_locate_tokens (
  id TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_log_id TEXT,
  customer_phone TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  formatted_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shared', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shared_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours')
);

CREATE INDEX IF NOT EXISTS live_gps_locate_tokens_owner_idx
  ON live_gps_locate_tokens (owner_user_id, created_at DESC);

COMMENT ON TABLE live_gps_locate_tokens IS
  'One-time locate links texted during live intake; customer GPS posts back via /api/locate.';
