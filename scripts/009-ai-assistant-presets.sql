-- ============================================
-- lyncr - Cloud-synced AI assistant presets
-- ============================================

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
