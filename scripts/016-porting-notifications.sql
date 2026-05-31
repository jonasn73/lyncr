-- ============================================
-- Porting notifications (Telnyx webhook → lyncr app)
-- ============================================
-- Run in Neon after 001. Stores carrier/porting updates so users see them in lyncr,
-- not only in the Telnyx dashboard inbox.

CREATE TABLE IF NOT EXISTS porting_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telnyx_event_id TEXT NOT NULL,
  porting_order_id TEXT,
  event_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  raw_payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_porting_notifications_event_id ON porting_notifications (telnyx_event_id);
CREATE INDEX IF NOT EXISTS idx_porting_notifications_user_created ON porting_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_porting_notifications_user_unread ON porting_notifications (user_id) WHERE read_at IS NULL;
