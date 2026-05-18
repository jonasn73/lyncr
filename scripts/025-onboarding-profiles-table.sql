-- Fix: Neon already had a different `profiles` table (no user_id column).
-- Run this if Launch shows: column "user_id" of relation "profiles" does not exist
-- Safe to run even if you never ran 024 — creates onboarding_profiles only.

CREATE TABLE IF NOT EXISTS onboarding_profiles (
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

CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_subscription ON onboarding_profiles(has_active_subscription);

COMMENT ON TABLE onboarding_profiles IS 'Onboarding + checkout progress; gates /dashboard until subscription + reserved_number are set.';
