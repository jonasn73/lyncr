-- Onboarding wizard state per user (reserved line, fallback script, billing gate).
-- Run in Neon after prior migrations.

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reserved_number TEXT,
  reserved_number_display TEXT,
  reserved_number_method TEXT CHECK (reserved_number_method IS NULL OR reserved_number_method IN ('buy', 'port')),
  port_carrier TEXT,
  fallback_type TEXT CHECK (fallback_type IS NULL OR fallback_type IN ('ai', 'voicemail')),
  trade_category TEXT,
  opening_line TEXT,
  has_active_subscription BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_subscription ON profiles(has_active_subscription);

COMMENT ON TABLE profiles IS 'Onboarding + checkout progress; gates /dashboard until subscription + reserved_number are set.';
COMMENT ON COLUMN profiles.reserved_number IS 'E.164 line reserved at checkout (provisioned after billing).';
COMMENT ON COLUMN profiles.opening_line IS 'AI or voicemail greeting script from onboarding step 3.';
