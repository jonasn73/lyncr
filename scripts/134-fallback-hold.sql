-- ============================================
-- Allow Advanced Rules missed-call fallback = hold queue
-- (Available: owner cell rings → no answer → soft hold / Lines Answer)
-- ============================================
-- Safe to re-run. Does not change existing rows (Key Squad stays on voicemail until you pick Hold queue).

ALTER TABLE routing_config
  DROP CONSTRAINT IF EXISTS routing_config_fallback_type_check;

ALTER TABLE routing_config
  ADD CONSTRAINT routing_config_fallback_type_check
  CHECK (fallback_type IN ('owner', 'ai', 'voicemail', 'hold'));
