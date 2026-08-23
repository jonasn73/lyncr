-- 140: App Improvement Board — admin-only backlog of app development improvements.
-- Lets platform admins log ideas/findings, plan what to tackle, mark done, or remove.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS app_improvements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  -- Free-text grouping (amber, payments, scheduler, crm, usability, testing, general, ...).
  category TEXT NOT NULL DEFAULT 'general',
  -- backlog (logged, not yet decided) -> planned (admin will tackle) -> in_progress -> done.
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'medium',
  -- Where the idea came from (a diagnostic pass, a feature request, etc.) — optional context.
  source TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_improvements_status_idx
  ON app_improvements (status, priority DESC, created_at DESC);

COMMENT ON TABLE app_improvements IS
  'Admin-only dev improvement board — backlog / planned / in_progress / done, freely deletable.';
