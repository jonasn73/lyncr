-- ============================================
-- 048 — Hybrid network: Private Staff vs Shared Lyncr Network Pool
-- ============================================
-- Run in Neon SQL Editor AFTER 047-messaging-10dlc.sql.
--
-- NOTE ON NUMBERING: the spec called this "043", but 043-certifications-training.sql
-- already exists (as do 044–047). Two files sharing prefix 043 would break the ordered
-- migration runner, so this ships as 048 — the next free number.
--
-- Defensive coexistence: every statement is idempotent (IF NOT EXISTS / DROP ... IF EXISTS)
-- and the app reads the new columns with graceful fallbacks, so routing keeps working
-- whether or not this migration has been applied yet.

-- 1) routing_config: per-line strategy + network fallback opt-in.
ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS routing_strategy TEXT NOT NULL DEFAULT 'private_only',
  ADD COLUMN IF NOT EXISTS allow_lyncr_network_fallback BOOLEAN NOT NULL DEFAULT false;

-- Constraint added separately so re-runs don't error ("already exists").
ALTER TABLE routing_config
  DROP CONSTRAINT IF EXISTS routing_config_routing_strategy_check;

ALTER TABLE routing_config
  ADD CONSTRAINT routing_config_routing_strategy_check
  CHECK (routing_strategy IN ('private_only', 'lyncr_only', 'hybrid_fallback'));

COMMENT ON COLUMN routing_config.routing_strategy IS
  'Who answers this line: private_only (this business''s own staff), lyncr_only (shared global Lyncr network agents), or hybrid_fallback (private first, then network). Defaults to private_only to protect existing routes.';
COMMENT ON COLUMN routing_config.allow_lyncr_network_fallback IS
  'When true, allow falling back to shared Lyncr network agents (user_id IS NULL) if no private staff are online.';

-- 2) receptionists: allow NULL user_id = shared global Lyncr network pool agent.
ALTER TABLE receptionists
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN receptionists.user_id IS
  'Owning business (client). NULL = shared global Lyncr network pool agent managed by the platform.';

-- Helps the strategy-scoped pool query split private vs network agents quickly.
CREATE INDEX IF NOT EXISTS idx_receptionists_network_pool
  ON receptionists(is_active)
  WHERE user_id IS NULL;
