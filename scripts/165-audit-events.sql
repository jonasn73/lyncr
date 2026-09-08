-- ============================================
-- 165 — Platform audit trail (admin /admin/audit)
-- ============================================
-- Generic signup-through-every-action event log. owner_user_id is whose account the
-- event is about; actor_user_id is who actually did it (may differ — a receptionist or
-- platform admin acting on an owner's account). Both nullable + ON DELETE SET NULL so a
-- later account deletion never silently erases the historical trail.
-- Run in Neon → SQL Editor after prior migrations.

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 'platform_admin' | 'owner' | 'receptionist' | 'field_tech' | 'system' | 'anonymous'
  actor_role TEXT NOT NULL,
  -- e.g. 'auth.signup', 'admin.impersonate_start', 'intake.job_created'
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_owner_created
  ON audit_events (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_type_created
  ON audit_events (event_type, created_at DESC);

COMMENT ON TABLE audit_events IS
  'Platform-wide audit trail — /admin/audit. See lib/audit-log.ts for the write path.';
