-- ============================================
-- 049 — Private ring timeout (hybrid network)
-- ============================================
-- Run in Neon SQL Editor AFTER 048-hybrid-network-fields.sql.
--
-- Adds how long a hybrid line should ring this business's PRIVATE staff before
-- falling back to the shared Lyncr network pool. Separate from ring_timeout_seconds
-- (which is the overall no-answer timeout before AI / voicemail fallback).
--
-- Defensive coexistence: idempotent, and the app reads this column with a graceful
-- default of 15s, so routing keeps working whether or not this migration has run.

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS private_ring_timeout_seconds INTEGER NOT NULL DEFAULT 15;

COMMENT ON COLUMN routing_config.private_ring_timeout_seconds IS
  'Hybrid routing: seconds to ring this business''s private staff before falling back to shared Lyncr network agents. Defaults to 15.';
