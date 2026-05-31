-- ============================================
-- lyncr - Database Schema
-- Run this against your Supabase/Neon database
-- ============================================

-- Users (business owners)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Receptionists / agents
CREATE TABLE IF NOT EXISTS receptionists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'bg-primary',
  rate_per_minute NUMERIC(6,4) NOT NULL DEFAULT 0.25,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_receptionists_user ON receptionists(user_id);

-- Routing configuration (one row per user)
CREATE TABLE IF NOT EXISTS routing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_receptionist_id UUID REFERENCES receptionists(id) ON DELETE SET NULL,
  fallback_type TEXT NOT NULL DEFAULT 'owner' CHECK (fallback_type IN ('owner', 'ai', 'voicemail')),
  ai_greeting TEXT NOT NULL DEFAULT 'Thank you for calling. Our team is currently unavailable. I can take a message, provide our business hours, or help direct your call. How can I help you?',
  ring_timeout_seconds INTEGER NOT NULL DEFAULT 20,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Phone numbers (purchased or ported via provider API)
CREATE TABLE IF NOT EXISTS phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_number_sid TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL,
  friendly_name TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT 'Main Line',
  type TEXT NOT NULL DEFAULT 'local' CHECK (type IN ('local', 'toll-free')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'porting')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_phone_numbers_user ON phone_numbers(user_id);

-- Call logs
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_call_sid TEXT NOT NULL DEFAULT '',
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  caller_name TEXT,
  call_type TEXT NOT NULL DEFAULT 'incoming' CHECK (call_type IN ('incoming', 'outgoing', 'missed', 'voicemail')),
  status TEXT NOT NULL DEFAULT 'completed',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  routed_to_receptionist_id UUID REFERENCES receptionists(id) ON DELETE SET NULL,
  routed_to_name TEXT,
  has_recording BOOLEAN NOT NULL DEFAULT false,
  recording_url TEXT,
  recording_duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_call_logs_user ON call_logs(user_id);
CREATE INDEX idx_call_logs_created ON call_logs(user_id, created_at DESC);
CREATE INDEX idx_call_logs_receptionist ON call_logs(routed_to_receptionist_id);

-- Cloud-synced AI assistant presets per user
CREATE TABLE IF NOT EXISTS ai_assistant_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_assistant_presets_user
  ON ai_assistant_presets(user_id, created_at DESC);
