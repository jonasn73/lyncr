-- Job photo request tokens + stored customer uploads for live intake.

CREATE TABLE IF NOT EXISTS job_photo_tokens (
  id TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_log_id TEXT,
  customer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '4 hours')
);

CREATE INDEX IF NOT EXISTS job_photo_tokens_owner_idx
  ON job_photo_tokens (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id TEXT NOT NULL REFERENCES job_photo_tokens(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_log_id TEXT,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  file_name TEXT,
  -- Compressed JPEG/PNG as base64 (client compresses before upload).
  data_base64 TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_photos_token_idx ON job_photos (token_id, created_at ASC);
CREATE INDEX IF NOT EXISTS job_photos_call_idx ON job_photos (owner_user_id, call_log_id, created_at DESC);

COMMENT ON TABLE job_photo_tokens IS
  'SMS upload links for intake — customer opens /upload?t=… during a live call.';
COMMENT ON TABLE job_photos IS
  'Customer-uploaded job photos (ignition/lockout) streamed into the intake gallery.';
